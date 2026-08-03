-- PostgreSQL / Supabase Full Schema for Bonn_Prod_WMS

-- 1. USER_AUTH Table (Matches Google Sheets USER_AUTH Headers 100%)
DROP TABLE IF EXISTS user_auth CASCADE;
CREATE TABLE user_auth (
    "User ID" TEXT PRIMARY KEY,
    "Name" TEXT,
    "Password" TEXT,
    "Assigned Warehouses" TEXT,
    "Admin_UserAuth" TEXT DEFAULT 'NO',
    "Admin_ActivityLog" TEXT DEFAULT 'NO',
    "Admin_ResetData" TEXT DEFAULT 'NO',
    "Setup_BinMaster" TEXT DEFAULT 'NO',
    "Setup_ProductMaster" TEXT DEFAULT 'NO',
    "Sales_StkDump" TEXT DEFAULT 'NO',
    "Sales_OrderChecker" TEXT DEFAULT 'NO',
    "Sales_ShortageChecker" TEXT DEFAULT 'NO',
    "Sales_AllocationView" TEXT DEFAULT 'NO',
    "Sales_ConfirmOutbound" TEXT DEFAULT 'NO',
    "Receipts_ASN" TEXT DEFAULT 'NO',
    "Receipts_CreateInbound" TEXT DEFAULT 'NO',
    "Receipts_ConfirmInbound" TEXT DEFAULT 'NO',
    "Receipts_InboundReport" TEXT DEFAULT 'NO',
    "Inventory_Reconciliation" TEXT DEFAULT 'NO',
    "Inventory_Enquiry" TEXT DEFAULT 'NO',
    "Inventory_Reports" TEXT DEFAULT 'NO'
);

-- 2. PARTY_MASTER Table (Contractors, Supervisors, Transport Name, GST)
CREATE TABLE IF NOT EXISTS party_master (
    id SERIAL PRIMARY KEY,
    contractor_name TEXT,
    supervisor_name TEXT,
    tpt_name TEXT,
    tpt_gst TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. OPERATION_SHEET Table (Outbound Orders & Dispatches)
CREATE TABLE IF NOT EXISTS operation_sheet (
    id SERIAL PRIMARY KEY,
    order_no TEXT NOT NULL UNIQUE,
    customer_name TEXT,
    sku_code TEXT,
    ordered_qty NUMERIC(10,2) DEFAULT 0,
    status TEXT DEFAULT 'Picking',
    vehicle_no TEXT,
    driver_no TEXT,
    tpt_name TEXT,
    tpt_gst TEXT,
    gst_shortage_reason TEXT,
    loading_supervisor TEXT,
    billing_supervisor TEXT,
    shift TEXT,
    loading_date DATE,
    contractor_name TEXT,
    loading_start_time TEXT,
    loading_end_time TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. SAP_STK_DUMP Table (Uploaded SAP Excel Dump Records)
CREATE TABLE IF NOT EXISTS sap_stk_dump (
    id SERIAL PRIMARY KEY,
    material_code TEXT,
    material_desc TEXT,
    batch TEXT,
    plant TEXT,
    total_qty NUMERIC(10,2) DEFAULT 0,
    allocated_qty NUMERIC(10,2) DEFAULT 0,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. PHY_STK_ALLOCATION Table
CREATE TABLE IF NOT EXISTS phy_stk_allocation (
    id SERIAL PRIMARY KEY,
    order_no TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    bin_no TEXT NOT NULL,
    allocated_qty NUMERIC(10,2) DEFAULT 0,
    month_year TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. PHY_STK_ENTRY Table (Physical Bin Inventory Balances)
CREATE TABLE IF NOT EXISTS phy_stk_entry (
    id SERIAL PRIMARY KEY,
    bin_no TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    available_qty NUMERIC(10,2) DEFAULT 0,
    mfg_line TEXT,
    batch_no TEXT,
    expiry_date DATE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes (< 2ms)
CREATE INDEX IF NOT EXISTS idx_op_status ON operation_sheet(status);
CREATE INDEX IF NOT EXISTS idx_alloc_order ON phy_stk_allocation(order_no);
CREATE INDEX IF NOT EXISTS idx_stk_sku_bin ON phy_stk_entry(sku_code, bin_no);
