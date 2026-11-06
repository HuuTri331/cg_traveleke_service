export const BOOKING_DOMAIN_EVENTS = {
  ROOM_CHECKOUT_CONFIRMED_V1: 'room.checkout.confirmed.v1',
  ROOM_READY_V1: 'room.ready.v1',
  ROOM_INCIDENT_OPENED_V1: 'room.incident.opened.v1',
  AMENDMENT_PAYMENT_CONFIRMED_V1: 'amendment.payment_confirmed.v1',
  AMENDMENT_COMMITTED_V1: 'amendment.committed.v1',
  FOLIO_CHANGED_V1: 'folio.changed.v1',
  PRECHECKIN_INVITE_REQUESTED_V1: 'precheckin.invite.requested.v1',
  PRECHECKIN_SUBMITTED_V1: 'precheckin.submitted.v1',
  ARRIVAL_ETA_UPDATED_V1: 'arrival.eta_updated.v1',
  NOTIFICATION_INTENT_REQUESTED_V1: 'notification.intent.requested.v1',
  WAITLIST_INVENTORY_RELEASED_V1: 'waitlist.inventory_released.v1',
} as const;

export function buildDomainEventKey(
  eventType: string,
  entityId: string | number,
  versionOrSubKey: string | number = 1,
): string {
  return `${eventType}:${String(entityId)}:${String(versionOrSubKey)}`;
}
