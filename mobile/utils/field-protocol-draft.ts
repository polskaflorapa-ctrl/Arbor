import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_FIELD_PROTOCOL, type FieldProtocolForm } from './field-protocol';

const KEY_PREFIX = 'field_protocol_draft_v1:';

export type FieldProtocolDraft = {
  inspectionId: string;
  protocol: FieldProtocolForm;
  updatedAt: string;
};

function keyForInspection(inspectionId: string) {
  return `${KEY_PREFIX}${inspectionId}`;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeFieldProtocolDraft(value: unknown): FieldProtocolForm {
  const source = value && typeof value === 'object' ? value as Partial<FieldProtocolForm> : {};
  return {
    work: stringList(source.work).length ? stringList(source.work) : DEFAULT_FIELD_PROTOCOL.work,
    equipment: stringList(source.equipment),
    risks: stringList(source.risks),
    haul: booleanValue(source.haul, DEFAULT_FIELD_PROTOCOL.haul),
    stumpRemoval: booleanValue(source.stumpRemoval, DEFAULT_FIELD_PROTOCOL.stumpRemoval),
    people: stringValue(source.people, DEFAULT_FIELD_PROTOCOL.people),
    time: stringValue(source.time),
    budget: stringValue(source.budget),
    discount: stringValue(source.discount),
    minPrice: stringValue(source.minPrice),
    acceptedPrice: stringValue(source.acceptedPrice),
    chips: stringValue(source.chips),
    wood: stringValue(source.wood),
    arborist: stringValue(source.arborist),
    workDetails: stringValue(source.workDetails),
    banner: booleanValue(source.banner, DEFAULT_FIELD_PROTOCOL.banner),
    result: stringValue(source.result, DEFAULT_FIELD_PROTOCOL.result),
    access: stringValue(source.access),
    notes: stringValue(source.notes),
  };
}

export async function loadFieldProtocolDraft(inspectionId: string): Promise<FieldProtocolDraft | null> {
  if (!inspectionId) return null;
  const raw = await AsyncStorage.getItem(keyForInspection(inspectionId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FieldProtocolDraft>;
    return {
      inspectionId,
      protocol: normalizeFieldProtocolDraft(parsed.protocol),
      updatedAt: stringValue(parsed.updatedAt, new Date().toISOString()),
    };
  } catch {
    await AsyncStorage.removeItem(keyForInspection(inspectionId));
    return null;
  }
}

export async function saveFieldProtocolDraft(
  inspectionId: string,
  protocol: FieldProtocolForm,
): Promise<FieldProtocolDraft> {
  const draft: FieldProtocolDraft = {
    inspectionId,
    protocol: normalizeFieldProtocolDraft(protocol),
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(keyForInspection(inspectionId), JSON.stringify(draft));
  return draft;
}

export async function clearFieldProtocolDraft(inspectionId: string) {
  if (!inspectionId) return;
  await AsyncStorage.removeItem(keyForInspection(inspectionId));
}
