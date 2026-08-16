const CONTRACTS = Object.freeze({
  sap_stock_dump: { source: 'SAP_STK_DUMP', target: 'wms.sap_stk_dump' },
  sap_allocation: { source: 'SAP_STK_ALLOCATION', target: 'wms.sap_stk_allocation' },
  physical_stock: { source: 'PHY_STK_ENTRY', target: 'wms.phy_stk_entry' },
  physical_allocation: { source: 'PHY_STK_ALLOCATION', target: 'wms.phy_stk_allocation' },
  clear_order: { source: 'Clear Order', target: 'wms.clear_order' },
  operation_sheet: { source: 'Operation_Sheet', target: 'wms.operation_sheet' },
  outward_mis: { source: 'Outward_MIS', target: 'wms.outward_mis' },
  bin_transactions: { source: 'BIN_TXIN', target: 'wms.bin_txin' }
});

function getSourceContract(logicalObject) {
  const contract = CONTRACTS[logicalObject];
  if (!contract) throw new Error(`Unknown source contract: ${logicalObject}`);
  return { logical_object: logicalObject, ...contract };
}

function listSourceContracts() {
  return Object.entries(CONTRACTS).map(([logical_object, contract]) => ({ logical_object, ...contract }));
}

module.exports = { getSourceContract, listSourceContracts };
