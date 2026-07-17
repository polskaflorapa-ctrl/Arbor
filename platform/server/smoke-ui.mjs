import { readFile } from 'node:fs/promises';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

const portalHtml = await readFile('public/prototypes/portal-klienta.html', 'utf8');
const desktopHtml = await readFile('public/prototypes/arbor-os.html', 'utf8');
const bridgeSource = await readFile('public/prototypes/prototype-api-bridge.js', 'utf8');
const hostSource = await readFile('src/main.tsx', 'utf8');

const portalScripts = inlineScripts(portalHtml);
assert(portalScripts.length > 0, 'Portal klienta nie ma inline script do sprawdzenia');
portalScripts.forEach((script, index) => {
  try {
    new Function(script);
  } catch (error) {
    throw new Error(`Portal klienta inline script ${index + 1} ma blad skladni: ${error.message}`);
  }
});

assert(portalHtml.includes('Nie można otworzyć portalu'), 'Portal nie pokazuje jasnego bledu dla zlego linku');
assert(
  portalHtml.includes("clientName: portalBlocked ? 'link nieaktywny'"),
  'Portal z blednym tokenem moze pokazac nazwe klienta z danych demo',
);
assert(
  portalHtml.includes('const stageOrder = portalBlocked ?'),
  'Portal z blednym tokenem moze pokazac przykładowa os statusow',
);
assert(
  portalHtml.includes('const seed = (portal.orderId || portalBlocked) ? []'),
  'Portal z blednym tokenem moze pokazac przykładowe wiadomosci',
);
assert(
  portalHtml.includes('quotePending: !portalBlocked'),
  'Portal z blednym tokenem moze pokazac akcje akceptacji oferty',
);
assert(
  hostSource.includes('function keyFromLocation()') && hostSource.includes("if (pathKey in prototypes) return pathKey"),
  'Host nie obsluguje bezposrednich sciezek prototypow',
);
assert(
  hostSource.includes("params.has('portalToken')") && hostSource.includes("params.set('token', portalToken)"),
  'Host nie przekazuje tokenu portalu do iframe',
);
assert(
  desktopHtml.includes('<sc-for list="{{ branchOptions }}" as="b"') && !desktopHtml.includes('<option value="1">Warszawa</option><option value="2">Kraków</option><option value="3">Gdańsk</option>'),
  'Nowe zlecenie musi uzywac realnych oddzialow z branchOptions, nie listy demo',
);
assert(
  desktopHtml.includes('err.miasto =') &&
    desktopHtml.includes('const branchId = String(f.miasto || this._firstBranchId())') &&
    desktopHtml.includes('const saveOrder = (client) =>') &&
    desktopHtml.includes('branchId'),
  'Nowe zlecenie musi walidowac oddzial i wysylac realny branchId do backendu',
);
assert(
  desktopHtml.includes('err.phone =') &&
    desktopHtml.includes("const phone = String(f.phone || '').trim()") &&
    desktopHtml.includes('window.ArborBridge.createClient'),
  'Nowe zlecenie musi wymagac telefonu i tworzyc/znajdowac klienta przed zleceniem',
);
assert(
  !desktopHtml.includes('const client = (this._arborClients || [])[0]'),
  'Nowe zlecenie nie moze przypisywac sprawy do pierwszego klienta z CRM',
);
assert(
  desktopHtml.includes('openOrderEdit(id)') && desktopHtml.includes("orderMode: 'edit'") && desktopHtml.includes('window.ArborBridge.updateOrder'),
  'Widok zlecenia musi obslugiwac edycje istniejacej sprawy przez updateOrder',
);
assert(
  desktopHtml.includes("orderSubmitLabel: this.state.orderMode === 'edit'") && desktopHtml.includes("edit: () => this.openOrderEdit(dt.id)"),
  'Szczegoly zlecenia musza miec akcje edycji i etykiete zapisu',
);
assert(
  bridgeSource.includes('cancelOrder(id)') && bridgeSource.includes("method: 'DELETE'"),
  'Bridge musi udostepniac anulowanie zlecenia przez DELETE /api/orders/:id',
);
assert(
  desktopHtml.includes('cancelOrder(id)') && desktopHtml.includes("cancel: () => this.cancelOrder(dt.id)") && desktopHtml.includes('title="Anuluj zlecenie"'),
  'Szczegoly zlecenia musza pozwalac anulowac sprawe z UI',
);
assert(
  desktopHtml.includes('_activeBranchIds()') &&
    desktopHtml.includes('_branchAccessError(id)') &&
    desktopHtml.includes('branch: nextBranch') &&
    desktopHtml.includes('this._hasActiveBranchAccess(branch.id)'),
  'Formularze i filtry musza uzywac aktywnych oddzialow dostepnych dla uzytkownika',
);
assert(
  desktopHtml.includes("refs.orders") &&
    desktopHtml.includes("{ label: 'Zlecenia', value: branchDeleteRefs.orders }") &&
    desktopHtml.includes('repeat(auto-fit,minmax(88px,1fr))'),
  'Usuwanie oddzialu musi pokazywac zlecenia w powiazaniach i miescic statystyki w UI',
);
assert(
  desktopHtml.includes('showAccountSwitcher()') &&
    desktopHtml.includes('window.ArborBridge?.logout') &&
    desktopHtml.includes('authLoggedOut: true') &&
    desktopHtml.includes('accountSwitch: () => this.showAccountSwitcher()'),
  'Zmiana konta musi realnie wylogowac stary token i pokazac wybor konta',
);
assert(
  desktopHtml.includes('clientCustomFieldRows') &&
    desktopHtml.includes('_clientCustomFieldDefs()') &&
    desktopHtml.includes('clientCustomField(k)') &&
    desktopHtml.includes('customFields: Object.fromEntries') &&
    desktopHtml.includes('clientConfiguredCustomRows(curClient)'),
  'Formularz i karta klienta musza obslugiwac wlasne pola CRM z konfiguracji modulu',
);
assert(
  desktopHtml.includes('_crmPipelineStages()') &&
    desktopHtml.includes("this._moduleStatuses('crm'") &&
    desktopHtml.includes('_crmStageMeta(s, index)') &&
    desktopHtml.includes('const stageOrder = this._crmPipelineStages()') &&
    !desktopHtml.includes("const stageOrder = ['lead', 'kontakt', 'oferta', 'negocjacje', 'wygrane']"),
  'Pipeline CRM musi brac etapy z konfiguracji modulu zamiast sztywnej listy',
);

console.log(JSON.stringify({
  ok: true,
  portalScripts: portalScripts.length,
  portalBadTokenGuard: true,
  directRoutes: true,
  orderBranchScope: true,
  orderClientBinding: true,
  orderEditing: true,
  orderCanceling: true,
  activeBranchForms: true,
  branchDeleteReferences: true,
  accountSwitchLogout: true,
  crmCustomFields: true,
  crmConfigurablePipeline: true,
}, null, 2));
