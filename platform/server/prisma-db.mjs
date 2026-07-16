import { PrismaClient } from '@prisma/client';
import seed from './seed.mjs';

export const prisma = new PrismaClient();

const parse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const stringify = (value) => JSON.stringify(value ?? null);

export async function ensureSeeded() {
  const branches = await prisma.branch.count();
  if (branches > 0) return;
  await resetDb();
}

export async function resetDb() {
  await prisma.outboxEvent.deleteMany();
  await prisma.offlineQueueItem.deleteMany();
  await prisma.portalState.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.valuation.deleteMany();
  await prisma.order.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();

  await prisma.branch.createMany({ data: seed.branches });
  await prisma.user.createMany({ data: seed.users.map((user) => ({ ...user, teamId: user.teamId ?? null })) });
  await prisma.client.createMany({
    data: seed.clients.map((client) => ({
      ...client,
      branchId: 'krk',
      tagsJson: stringify(client.tags),
      customFields: stringify(client.customFields),
    })),
  });
  await prisma.crew.createMany({
    data: seed.crews.map((crew) => ({ ...crew, membersJson: stringify(crew.members) })),
  });
  await prisma.order.createMany({
    data: seed.orders.map((order) => ({
      ...order,
      teamId: order.teamId ?? null,
      estimatorId: order.estimatorId ?? null,
      inspectionAt: order.inspectionAt ?? null,
      timelineJson: stringify(order.timeline),
      checklistJson: stringify(order.checklist),
    })),
  });
  await prisma.valuation.createMany({
    data: seed.valuations.map((valuation) => ({
      ...valuation,
      mediaJson: stringify(valuation.media),
      itemsJson: stringify(valuation.items),
    })),
  });
  await prisma.equipment.createMany({ data: seed.equipment });
  await prisma.invoice.createMany({
    data: seed.invoices.map((invoice) => ({ ...invoice, paidAt: invoice.paidAt ?? null })),
  });
  await prisma.notification.createMany({ data: seed.notifications });
  await prisma.auditEvent.createMany({ data: seed.auditEvents });
  await prisma.portalState.create({
    data: {
      id: 'singleton',
      accepted: seed.portal.accepted,
      paid: seed.portal.paid,
      rating: seed.portal.rating,
      messagesJson: stringify(seed.portal.messages),
    },
  });
}

export async function loadDb() {
  await ensureSeeded();
  const [
    branches,
    users,
    clientsRaw,
    crewsRaw,
    ordersRaw,
    valuationsRaw,
    equipment,
    invoices,
    notifications,
    auditEvents,
    portalRaw,
    offlineItems,
    outboxRaw,
  ] = await Promise.all([
    prisma.branch.findMany(),
    prisma.user.findMany(),
    prisma.client.findMany(),
    prisma.crew.findMany(),
    prisma.order.findMany(),
    prisma.valuation.findMany(),
    prisma.equipment.findMany(),
    prisma.invoice.findMany(),
    prisma.notification.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.auditEvent.findMany({ orderBy: { at: 'desc' } }),
    prisma.portalState.findUnique({ where: { id: 'singleton' } }),
    prisma.offlineQueueItem.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.outboxEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  return {
    branches,
    users,
    clients: clientsRaw.map(({ tagsJson, customFields, ...client }) => ({
      ...client,
      tags: parse(tagsJson, []),
      customFields: parse(customFields, {}),
    })),
    crews: crewsRaw.map(({ membersJson, ...crew }) => ({ ...crew, members: parse(membersJson, []) })),
    orders: ordersRaw.map(({ timelineJson, checklistJson, ...order }) => ({
      ...order,
      teamId: order.teamId ?? undefined,
      estimatorId: order.estimatorId ?? undefined,
      inspectionAt: order.inspectionAt ?? undefined,
      timeline: parse(timelineJson, []),
      checklist: parse(checklistJson, []),
    })),
    valuations: valuationsRaw.map(({ mediaJson, itemsJson, ...valuation }) => ({
      ...valuation,
      media: parse(mediaJson, []),
      items: parse(itemsJson, []),
    })),
    equipment,
    invoices: invoices.map((invoice) => ({ ...invoice, paidAt: invoice.paidAt ?? undefined })),
    notifications,
    auditEvents,
    portal: portalRaw
      ? {
          accepted: portalRaw.accepted,
          paid: portalRaw.paid,
          rating: portalRaw.rating,
          messages: parse(portalRaw.messagesJson, []),
        }
      : seed.portal,
    offlineQueue: offlineItems.map((item) => item.label),
    outbox: outboxRaw.map(({ payloadJson, ...event }) => ({ ...event, payload: parse(payloadJson, {}) })),
  };
}

export async function saveOrderStatus(orderId, status, actor) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return null;
  const timeline = parse(order.timelineJson, []);
  timeline.push({ label: `Status: ${status}`, at: new Date().toISOString(), by: `${actor.firstName} ${actor.lastName}` });
  return prisma.order.update({
    where: { id: orderId },
    data: { status, timelineJson: stringify(timeline) },
  });
}

export async function assignOrderTeam(orderId, teamId) {
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { teamId, status: 'ZAPLANOWANE' },
  });
  await prisma.valuation.updateMany({ where: { orderId }, data: { status: 'przydzielona' } });
  return order;
}

export async function saveValuationStatus(id, status) {
  return prisma.valuation.update({ where: { id }, data: { status } });
}

export async function saveInvoiceStatus(id, status) {
  return prisma.invoice.update({
    where: { id },
    data: { status, paidAt: status === 'oplacona' ? new Date().toISOString() : undefined },
  });
}

export async function markNotificationsRead() {
  await prisma.notification.updateMany({ data: { unread: false } });
}

export async function savePortalPatch(patch) {
  const current = await prisma.portalState.findUnique({ where: { id: 'singleton' } });
  const data = {};
  if ('accepted' in patch) data.accepted = Boolean(patch.accepted);
  if ('paid' in patch) data.paid = Boolean(patch.paid);
  if ('rating' in patch) data.rating = Number(patch.rating);
  if ('messages' in patch) data.messagesJson = stringify(patch.messages);
  return prisma.portalState.update({ where: { id: current?.id ?? 'singleton' }, data });
}

export async function addPortalMessage(message) {
  const current = await prisma.portalState.findUnique({ where: { id: 'singleton' } });
  const messages = parse(current?.messagesJson, []);
  messages.push(message);
  messages.push('Biuro: dziękujemy, wrócimy z odpowiedzią w ciągu 15 minut.');
  return prisma.portalState.update({ where: { id: 'singleton' }, data: { messagesJson: stringify(messages) } });
}

export async function addOfflineQueue(label) {
  await prisma.offlineQueueItem.create({ data: { id: crypto.randomUUID(), label, createdAt: new Date().toISOString() } });
}

export async function clearOfflineQueue() {
  await prisma.offlineQueueItem.deleteMany();
}

export async function pushEvent(actor, channel, eventName, payload) {
  const createdAt = new Date().toISOString();
  const event = { id: crypto.randomUUID(), actorId: actor.id, channel, eventName, payload, createdAt, deliveredAt: null };
  await prisma.$transaction([
    prisma.outboxEvent.create({
      data: {
        id: event.id,
        actorId: actor.id,
        channel,
        eventName,
        payloadJson: stringify(payload),
        createdAt,
      },
    }),
    prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        actorId: actor.id,
        action: eventName,
        entity: payload.id ?? payload.orderId ?? channel,
        at: createdAt,
        payload: stringify(payload),
      },
    }),
    prisma.notification.create({
      data: {
        id: crypto.randomUUID(),
        channel,
        role: 'ALL',
        title: eventName,
        body: stringify(payload),
        unread: true,
        createdAt,
      },
    }),
  ]);
  return event;
}

export async function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

export async function findUserByLogin(login) {
  return prisma.user.findUnique({ where: { login } });
}
