/**
 * Phase 7C — inbound confirmation transaction contract.
 *
 * Gold-Master target: iwConfirmInboundObd22().
 *
 * This module deliberately uses injected adapters. The repository has verified
 * the logical flow, but the Gold Master does not provide enough evidence to
 * invent physical SQL column mappings for every downstream table (especially
 * SAP_STK_DUMP). Therefore this layer freezes the transaction order and
 * response contract without guessing schema names.
 *
 * Required transaction order:
 *   INWARD_MIS -> SAP_STK_DUMP -> PHY_STK_ENTRY -> BIN_TXIN
 * plus the Stock_Entry compatibility state where the confirmation flow needs it.
 *
 * Every adapter participates in one DB transaction supplied by the caller.
 */

function norm(v) {
  return String(v ?? '').trim().toUpperCase();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function validatePayload(payload) {
  if (!payload || !norm(payload.obd)) return 'OBD is required';
  if (!Array.isArray(payload.items) || !payload.items.length) return 'items are required';

  for (const [i, item] of payload.items.entries()) {
    if (!norm(item.sku)) return `items[${i}].sku is required`;
    const qty = n(item.phyQty);
    if (qty < 0) return `items[${i}].phyQty cannot be negative`;
    if (qty > 0 && !norm(item.bin)) return `items[${i}].bin is required when physical quantity is greater than zero`;
  }
  return null;
}

function buildLogicalItems(payload) {
  return payload.items.map(item => {
    const billQty = n(item.billQty);
    const phyQty = n(item.phyQty);
    const variance = phyQty - billQty;
    return {
      rowIndex: item.rowIndex,
      sku: norm(item.sku),
      description: item.desc || '',
      billedBatch: norm(item.billedBatch),
      phyBatch: norm(item.phyBatch),
      billQty,
      phyQty,
      shortExcess: variance,
      status: variance === 0 ? 'OK' : variance > 0 ? 'EXCESS' : 'SHORT',
      bin: norm(item.bin),
      isSplit: Boolean(item.isSplit)
    };
  });
}

function assertAdapters(adapters) {
  const required = ['inwardMis', 'sapDump', 'phyStock', 'binTxin'];
  for (const name of required) {
    if (!adapters?.[name] || typeof adapters[name].apply !== 'function') {
      throw new Error(`Missing ${name} adapter`);
    }
  }
}

/**
 * Execute the Gold-Master-shaped inbound confirmation as one transaction.
 *
 * db must expose connect() returning a client with query(), release().
 * Each adapter receives (client, context) and must perform its own exact SQL
 * mapping once that mapping is verified against the production schema.
 */
async function confirmInboundObd22({ db, adapters, payload }) {
  const validationError = validatePayload(payload);
  if (validationError) return { status: 'ERROR', error: validationError };

  assertAdapters(adapters);

  const logicalItems = buildLogicalItems(payload);
  const context = {
    obd: norm(payload.obd),
    supervisorName: payload.supervisorName || '',
    contractorName: payload.contractorName || '',
    startTime: payload.startTime || '',
    endTime: payload.endTime || '',
    dockNum: payload.dockNum || '',
    shift: payload.shift || '',
    unloadingDate: payload.unloadingDate || null,
    grn: payload.grn || '',
    warehouse: norm(payload.warehouse),
    activeUser: payload.activeUser || '',
    items: logicalItems
  };

  const client = await db.connect();
  const applied = [];
  try {
    await client.query('BEGIN');

    // Do not reorder: downstream stock state depends on this sequence.
    await adapters.inwardMis.apply(client, context);
    applied.push('INWARD_MIS');

    await adapters.sapDump.apply(client, context);
    applied.push('SAP_STK_DUMP');

    await adapters.phyStock.apply(client, context);
    applied.push('PHY_STK_ENTRY');

    await adapters.binTxin.apply(client, context);
    applied.push('BIN_TXIN');

    await client.query('COMMIT');

    const savedStock = logicalItems.reduce((sum, item) => sum + item.phyQty, 0);
    return {
      status: 'DONE',
      savedStock,
      obd: context.obd,
      applied
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return {
      status: 'ERROR',
      error: error.message,
      transaction: 'ROLLED_BACK',
      applied
    };
  } finally {
    client.release();
  }
}

module.exports = {
  confirmInboundObd22,
  validatePayload,
  buildLogicalItems,
  norm,
  n
};
