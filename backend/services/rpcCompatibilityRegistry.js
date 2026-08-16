// Phase 9D: compatibility registry only.
// This does not implement or enable production RPC writes.
const RPC_CONTRACTS = Object.freeze({
  stock: [
    'ocGetDumpInfo', 'ocGetStock', 'ocReplaceDump', 'ocGetDumpExport'
  ],
  allocation: [
    'ocAllocateStoredOrders', 'ocCheckAllocationsForStored', 'ocGetOrderAllocationSummary',
    'ocGetSkuAllocation', 'ocRemoveAllocation', 'ocResetAllocation'
  ],
  orders: [
    'ocSubmitClearOrder', 'ocSubmitDirectOrder', 'ocSubmitPartialOrder',
    'ocDeletePartialOrder', 'ocUpdatePartialOrder', 'ocUnblockOrder'
  ],
  outbound: [
    'ocDispatchOrder', 'ocSaveVehDriver', 'opAllocateOBDBatches',
    'opConfirmOutboundDeductStock', 'opConfirmOutboundPickList',
    'opDeductBatchPickingAndMIS', 'opFetchOutboundPgiOrders',
    'opFetchOutboundPickingOrders'
  ],
  inventory: [
    'invGetPhysicalStockOverview', 'invGetStockSnapshot', 'invGetBinStockDetails',
    'invManualAddStock', 'invManualAdjustStock', 'invResolveVariance'
  ],
  inbound: [
    'iwSaveAsn', 'iwLoadPendingObds22', 'iwConfirmInboundObd22',
    'iwBatchInwardWithMIS', 'iwLoadAllInwardMisData'
  ],
  auth: [
    'wmsLogin', 'wmsLogoutSession', 'wmsHeartbeat', 'wmsGetUsers'
  ]
});

function listRpcContracts() {
  return Object.entries(RPC_CONTRACTS).flatMap(([domain, methods]) =>
    methods.map(method => ({ domain, method, implemented: false, production_enabled: false }))
  );
}

function getRpcContract(method) {
  const entry = listRpcContracts().find(x => x.method === method);
  if (!entry) throw new Error(`Unknown RPC contract: ${method}`);
  return entry;
}

module.exports = { listRpcContracts, getRpcContract };
