export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_parent: boolean
          is_system: boolean
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_parent?: boolean
          is_system?: boolean
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_parent?: boolean
          is_system?: boolean
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          address: string | null
          business_activity: string | null
          commercial_register: string | null
          company_name: string
          company_name_en: string | null
          created_at: string
          customer_payment_prefix: string
          default_currency: string
          email: string | null
          enable_fiscal_year_closing: boolean
          enable_return_days_limit: boolean
          enable_tax: boolean
          expense_prefix: string
          fiscal_year_start: string
          id: string
          inventory_dead_days: number
          inventory_lead_time_days: number
          inventory_new_days: number
          inventory_slow_days: number
          inventory_target_cover_days: number
          invoice_footer: string | null
          invoice_notes: string | null
          journal_entry_prefix: string
          locked_until_date: string | null
          logo_url: string | null
          loyalty_egp_per_point: number
          loyalty_enabled: boolean
          loyalty_points_per_redeem: number
          loyalty_redeem_value: number
          monthly_sales_target: number
          payment_terms_days: number
          phone: string | null
          product_code_prefix: string
          purchase_invoice_prefix: string
          purchase_return_prefix: string
          purchase_tax_account_id: string | null
          return_days_limit: number
          sales_invoice_prefix: string
          sales_return_prefix: string
          sales_tax_account_id: string | null
          show_discount_on_invoice: boolean
          show_tax_on_invoice: boolean
          singleton: boolean | null
          stock_enforcement_enabled: boolean | null
          supplier_payment_prefix: string
          tax_number: string | null
          tax_rate: number
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          business_activity?: string | null
          commercial_register?: string | null
          company_name?: string
          company_name_en?: string | null
          created_at?: string
          customer_payment_prefix?: string
          default_currency?: string
          email?: string | null
          enable_fiscal_year_closing?: boolean
          enable_return_days_limit?: boolean
          enable_tax?: boolean
          expense_prefix?: string
          fiscal_year_start?: string
          id?: string
          inventory_dead_days?: number
          inventory_lead_time_days?: number
          inventory_new_days?: number
          inventory_slow_days?: number
          inventory_target_cover_days?: number
          invoice_footer?: string | null
          invoice_notes?: string | null
          journal_entry_prefix?: string
          locked_until_date?: string | null
          logo_url?: string | null
          loyalty_egp_per_point?: number
          loyalty_enabled?: boolean
          loyalty_points_per_redeem?: number
          loyalty_redeem_value?: number
          monthly_sales_target?: number
          payment_terms_days?: number
          phone?: string | null
          product_code_prefix?: string
          purchase_invoice_prefix?: string
          purchase_return_prefix?: string
          purchase_tax_account_id?: string | null
          return_days_limit?: number
          sales_invoice_prefix?: string
          sales_return_prefix?: string
          sales_tax_account_id?: string | null
          show_discount_on_invoice?: boolean
          show_tax_on_invoice?: boolean
          singleton?: boolean | null
          stock_enforcement_enabled?: boolean | null
          supplier_payment_prefix?: string
          tax_number?: string | null
          tax_rate?: number
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          business_activity?: string | null
          commercial_register?: string | null
          company_name?: string
          company_name_en?: string | null
          created_at?: string
          customer_payment_prefix?: string
          default_currency?: string
          email?: string | null
          enable_fiscal_year_closing?: boolean
          enable_return_days_limit?: boolean
          enable_tax?: boolean
          expense_prefix?: string
          fiscal_year_start?: string
          id?: string
          inventory_dead_days?: number
          inventory_lead_time_days?: number
          inventory_new_days?: number
          inventory_slow_days?: number
          inventory_target_cover_days?: number
          invoice_footer?: string | null
          invoice_notes?: string | null
          journal_entry_prefix?: string
          locked_until_date?: string | null
          logo_url?: string | null
          loyalty_egp_per_point?: number
          loyalty_enabled?: boolean
          loyalty_points_per_redeem?: number
          loyalty_redeem_value?: number
          monthly_sales_target?: number
          payment_terms_days?: number
          phone?: string | null
          product_code_prefix?: string
          purchase_invoice_prefix?: string
          purchase_return_prefix?: string
          purchase_tax_account_id?: string | null
          return_days_limit?: number
          sales_invoice_prefix?: string
          sales_return_prefix?: string
          sales_tax_account_id?: string | null
          show_discount_on_invoice?: boolean
          show_tax_on_invoice?: boolean
          singleton?: boolean | null
          stock_enforcement_enabled?: boolean | null
          supplier_payment_prefix?: string
          tax_number?: string | null
          tax_rate?: number
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_purchase_tax_account_id_fkey"
            columns: ["purchase_tax_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_sales_tax_account_id_fkey"
            columns: ["sales_tax_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_payment_allocations: {
        Row: {
          allocated_amount: number
          created_at: string
          id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          allocated_amount: number
          created_at?: string
          id?: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          allocated_amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          journal_entry_id: string | null
          notes: string | null
          payment_date: string
          payment_method: string
          payment_number: number
          posted_number: number | null
          reference: string | null
          sales_invoice_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: string
          payment_number?: number
          posted_number?: number | null
          reference?: string | null
          sales_invoice_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: string
          payment_number?: number
          posted_number?: number | null
          reference?: string | null
          sales_invoice_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          balance: number
          code: string
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          loyalty_enabled: boolean
          loyalty_points: number
          name: string
          notes: string | null
          opening_balance: number
          phone: string | null
          tax_number: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          balance?: number
          code: string
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          loyalty_enabled?: boolean
          loyalty_points?: number
          name: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          tax_number?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          balance?: number
          code?: string
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          loyalty_enabled?: boolean
          loyalty_points?: number
          name?: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          tax_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      expense_types: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_types_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          expense_date: string
          expense_number: number
          expense_type_id: string
          id: string
          journal_entry_id: string | null
          payment_method: string
          posted_number: number | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          expense_number?: number
          expense_type_id: string
          id?: string
          journal_entry_id?: string | null
          payment_method?: string
          posted_number?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          expense_number?: number
          expense_type_id?: string
          id?: string
          journal_entry_id?: string | null
          payment_method?: string
          posted_number?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_expense_type_id_fkey"
            columns: ["expense_type_id"]
            isOneToOne: false
            referencedRelation: "expense_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustment_items: {
        Row: {
          actual_quantity: number
          adjustment_id: string
          created_at: string
          difference: number
          id: string
          notes: string | null
          product_id: string
          system_quantity: number
          total_cost: number
          unit_cost: number
        }
        Insert: {
          actual_quantity?: number
          adjustment_id: string
          created_at?: string
          difference?: number
          id?: string
          notes?: string | null
          product_id: string
          system_quantity?: number
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          actual_quantity?: number
          adjustment_id?: string
          created_at?: string
          difference?: number
          id?: string
          notes?: string | null
          product_id?: string
          system_quantity?: number
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustment_items_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "inventory_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustment_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustments: {
        Row: {
          adjustment_date: string
          adjustment_number: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          journal_entry_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          adjustment_date?: string
          adjustment_number?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          journal_entry_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          adjustment_date?: string
          adjustment_number?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          journal_entry_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          movement_date: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          notes: string | null
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_date?: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          notes?: string | null
          product_id: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_date?: string
          movement_type?: Database["public"]["Enums"]["inventory_movement_type"]
          notes?: string | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          entry_number: number
          entry_type: string | null
          id: string
          posted_number: number | null
          status: string
          total_credit: number
          total_debit: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          entry_date?: string
          entry_number?: number
          entry_type?: string | null
          id?: string
          posted_number?: number | null
          status?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          entry_number?: number
          entry_type?: string | null
          id?: string
          posted_number?: number | null
          status?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Relationships: []
      }
      journal_entry_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          description: string | null
          id: string
          journal_entry_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          notes: string | null
          points: number
          reference_id: string | null
          reference_type: string | null
          transaction_date: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          notes?: string | null
          points: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          notes?: string | null
          points?: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_brands: {
        Row: {
          country: string | null
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
        }
        Update: {
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          created_at: string
          id: string
          image_url: string
          product_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          product_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_units: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          symbol: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          symbol?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          symbol?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null
          barcode_label: string | null
          barcode_price: number | null
          brand_id: string | null
          category_id: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          main_image_url: string | null
          min_stock_level: number
          model_number: string | null
          name: string
          purchase_price: number
          quantity_on_hand: number
          selling_price: number
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          barcode_label?: string | null
          barcode_price?: number | null
          brand_id?: string | null
          category_id?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          main_image_url?: string | null
          min_stock_level?: number
          model_number?: string | null
          name: string
          purchase_price?: number
          quantity_on_hand?: number
          selling_price?: number
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          barcode_label?: string | null
          barcode_price?: number | null
          brand_id?: string | null
          category_id?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          main_image_url?: string | null
          min_stock_level?: number
          model_number?: string | null
          name?: string
          purchase_price?: number
          quantity_on_hand?: number
          selling_price?: number
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      purchase_invoice_items: {
        Row: {
          created_at: string
          description: string | null
          discount: number
          id: string
          invoice_id: string
          net_total: number
          product_id: string | null
          quantity: number
          sort_order: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          discount?: number
          id?: string
          invoice_id: string
          net_total?: number
          product_id?: string | null
          quantity?: number
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          discount?: number
          id?: string
          invoice_id?: string
          net_total?: number
          product_id?: string | null
          quantity?: number
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoice_return_settlements: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          return_id: string
          settled_amount: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          return_id: string
          settled_amount: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          return_id?: string
          settled_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_return_settlements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_return_settlements_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          discount: number
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: number
          journal_entry_id: string | null
          notes: string | null
          paid_amount: number
          posted_number: number | null
          reference: string | null
          status: string
          subtotal: number
          supplier_id: string | null
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: number
          journal_entry_id?: string | null
          notes?: string | null
          paid_amount?: number
          posted_number?: number | null
          reference?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: number
          journal_entry_id?: string | null
          notes?: string | null
          paid_amount?: number
          posted_number?: number | null
          reference?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_return_items: {
        Row: {
          created_at: string
          description: string | null
          discount: number
          id: string
          net_total: number
          product_id: string | null
          quantity: number
          return_id: string
          sort_order: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          discount?: number
          id?: string
          net_total?: number
          product_id?: string | null
          quantity?: number
          return_id: string
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          discount?: number
          id?: string
          net_total?: number
          product_id?: string | null
          quantity?: number
          return_id?: string
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_return_payment_allocations: {
        Row: {
          allocated_amount: number
          created_at: string
          id: string
          payment_id: string
          return_id: string
        }
        Insert: {
          allocated_amount: number
          created_at?: string
          id?: string
          payment_id: string
          return_id: string
        }
        Update: {
          allocated_amount?: number
          created_at?: string
          id?: string
          payment_id?: string
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_payment_allocations_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_returns: {
        Row: {
          created_at: string
          created_by: string | null
          discount: number
          id: string
          journal_entry_id: string | null
          notes: string | null
          posted_number: number | null
          purchase_invoice_id: string | null
          reference: string | null
          return_date: string
          return_number: number
          status: string
          subtotal: number
          supplier_id: string | null
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discount?: number
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_number?: number | null
          purchase_invoice_id?: string | null
          reference?: string | null
          return_date?: string
          return_number?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discount?: number
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_number?: number | null
          purchase_invoice_id?: string | null
          reference?: string | null
          return_date?: string
          return_number?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_returns_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_items: {
        Row: {
          created_at: string
          description: string | null
          discount: number
          id: string
          invoice_id: string
          net_total: number
          product_id: string | null
          quantity: number
          sort_order: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          discount?: number
          id?: string
          invoice_id: string
          net_total?: number
          product_id?: string | null
          quantity?: number
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          discount?: number
          id?: string
          invoice_id?: string
          net_total?: number
          product_id?: string | null
          quantity?: number
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_return_settlements: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          return_id: string
          settled_amount: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          return_id: string
          settled_amount: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          return_id?: string
          settled_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_return_settlements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_return_settlements_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sales_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount: number
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: number
          journal_entry_id: string | null
          loyalty_discount: number
          loyalty_points_redeemed: number
          notes: string | null
          paid_amount: number
          posted_number: number | null
          reference: string | null
          status: string
          subtotal: number
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: number
          journal_entry_id?: string | null
          loyalty_discount?: number
          loyalty_points_redeemed?: number
          notes?: string | null
          paid_amount?: number
          posted_number?: number | null
          reference?: string | null
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: number
          journal_entry_id?: string | null
          loyalty_discount?: number
          loyalty_points_redeemed?: number
          notes?: string | null
          paid_amount?: number
          posted_number?: number | null
          reference?: string | null
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_return_items: {
        Row: {
          created_at: string
          description: string | null
          discount: number
          id: string
          net_total: number
          product_id: string | null
          quantity: number
          return_id: string
          sort_order: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          discount?: number
          id?: string
          net_total?: number
          product_id?: string | null
          quantity?: number
          return_id: string
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          discount?: number
          id?: string
          net_total?: number
          product_id?: string | null
          quantity?: number
          return_id?: string
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sales_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_return_payment_allocations: {
        Row: {
          allocated_amount: number
          created_at: string
          id: string
          payment_id: string
          return_id: string
        }
        Insert: {
          allocated_amount: number
          created_at?: string
          id?: string
          payment_id: string
          return_id: string
        }
        Update: {
          allocated_amount?: number
          created_at?: string
          id?: string
          payment_id?: string
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_return_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_payment_allocations_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sales_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_returns: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount: number
          id: string
          journal_entry_id: string | null
          notes: string | null
          posted_number: number | null
          reference: string | null
          return_date: string
          return_number: number
          sales_invoice_id: string | null
          status: string
          subtotal: number
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_number?: number | null
          reference?: string | null
          return_date?: string
          return_number?: number
          sales_invoice_id?: string | null
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_number?: number | null
          reference?: string | null
          return_date?: string
          return_number?: number
          sales_invoice_id?: string | null
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_returns_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payment_allocations: {
        Row: {
          allocated_amount: number
          created_at: string
          id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          allocated_amount: number
          created_at?: string
          id?: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          allocated_amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          payment_date: string
          payment_method: string
          payment_number: number
          posted_number: number | null
          purchase_invoice_id: string | null
          reference: string | null
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: string
          payment_number?: number
          posted_number?: number | null
          purchase_invoice_id?: string | null
          reference?: string | null
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: string
          payment_number?: number
          posted_number?: number | null
          purchase_invoice_id?: string | null
          reference?: string | null
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          balance: number
          code: string
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          opening_balance: number
          phone: string | null
          tax_number: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          balance?: number
          code: string
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          tax_number?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          balance?: number
          code?: string
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          tax_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      telegram_post_log: {
        Row: {
          channel_id: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          images_count: number
          message_id: number | null
          product_id: string
          status: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          images_count?: number
          message_id?: number | null
          product_id: string
          status?: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          images_count?: number
          message_id?: number | null
          product_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_post_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_post_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_settings: {
        Row: {
          bot_token: string | null
          bot_token_hint: string | null
          channel_id: string | null
          created_at: string
          id: string
          is_enabled: boolean
          message_template: string
          price_source: string
          show_price: boolean
          show_stock: boolean
          updated_at: string
        }
        Insert: {
          bot_token?: string | null
          bot_token_hint?: string | null
          channel_id?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          message_template?: string
          price_source?: string
          show_price?: boolean
          show_stock?: boolean
          updated_at?: string
        }
        Update: {
          bot_token?: string | null
          bot_token_hint?: string | null
          channel_id?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          message_template?: string
          price_source?: string
          show_price?: boolean
          show_stock?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_product_quantity: {
        Args: { p_delta: number; p_product_id: string }
        Returns: number
      }
      admin_insert_profile: {
        Args: { p_full_name: string; p_id: string }
        Returns: undefined
      }
      admin_insert_user_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
      create_journal_entry: {
        Args: {
          p_description: string
          p_entry_date: string
          p_entry_type?: string
          p_lines: Json
          p_posted_number?: number
          p_status?: string
        }
        Returns: string
      }
      edit_customer_payment: {
        Args: {
          p_amount: number
          p_customer_id: string
          p_notes: string
          p_payment_date: string
          p_payment_id: string
          p_payment_method: string
          p_reference: string
        }
        Returns: Json
      }
      edit_journal_entry: {
        Args: {
          p_description: string
          p_entry_date: string
          p_entry_id: string
          p_lines: Json
        }
        Returns: string
      }
      edit_supplier_payment: {
        Args: {
          p_amount: number
          p_notes: string
          p_payment_date: string
          p_payment_id: string
          p_payment_method: string
          p_reference: string
          p_supplier_id: string
        }
        Returns: Json
      }
      fn_validate_journal_lines_json: {
        Args: { p_lines: Json }
        Returns: number
      }
      get_account_balances: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_only_with_activity?: boolean
        }
        Returns: Json
      }
      get_account_statement: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_entity_id: string
          p_entity_type: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      get_avg_purchase_price: { Args: { _product_id: string }; Returns: number }
      get_avg_selling_price: { Args: { _product_id: string }; Returns: number }
      get_inventory_aging: {
        Args: { p_as_of?: string; p_dead_days?: number; p_slow_days?: number }
        Returns: Json
      }
      get_inventory_kpis: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      get_inventory_movements_summary: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_product_id?: string
        }
        Returns: Json
      }
      get_inventory_reorder: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_lead_time_days?: number
          p_target_days?: number
        }
        Returns: Json
      }
      get_inventory_valuation: { Args: { p_as_of?: string }; Returns: Json }
      get_journal_summary: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      get_ledger_active_accounts: { Args: never; Returns: Json }
      get_ledger_lines: {
        Args: {
          p_account_id?: string
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      get_products_summary: { Args: never; Returns: Json }
      get_purchases_summary: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      get_sales_summary: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      get_sales_report_summary: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_previous_from: string
          p_previous_to: string
        }
        Returns: Json
      }
      get_sales_report_summary_filtered: {
        Args: {
          p_customer_filter?: string | null
          p_date_from: string
          p_date_to: string
          p_previous_from: string
          p_previous_to: string
        }
        Returns: Json
      }
      get_sales_product_catalog: {
        Args: never
        Returns: {
          barcode: string | null
          code: string
          id: string
          is_active: boolean
          model_number: string | null
          name: string
          product_brands: Json
          quantity_on_hand: number
          selling_price: number
        }[]
      }
      get_top_products: {
        Args: { p_limit?: number }
        Returns: {
          product_id: string
          product_name: string
          total_amount: number
          total_qty: number
        }[]
      }
      get_unpaid_invoices: {
        Args: { p_limit?: number }
        Returns: {
          customer_id: string
          customer_name: string
          id: string
          invoice_number: number
          paid_amount: number
          posted_number: number
          remaining: number
          total: number
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inventory_product_state: {
        Args: { p_as_of: string }
        Returns: {
          first_movement_date: string
          last_receipt_date: string
          last_sale_date: string
          moves_value: number
          product_id: string
          purchased_cost: number
          purchased_qty: number
          quantity: number
          sold_cost: number
          sold_qty: number
          wac: number
        }[]
      }
      inventory_signed_quantity: {
        Args: { p_movement_type: string; p_quantity: number }
        Returns: number
      }
      is_system_journal_entry: {
        Args: { p_entry_id: string }
        Returns: boolean
      }
      post_purchase_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      post_sales_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      product_computed_quantity: {
        Args: { p_product_id: string }
        Returns: number
      }
      replace_journal_entry_lines: {
        Args: {
          p_description?: string
          p_entry_date?: string
          p_entry_id: string
          p_lines: Json
          p_status?: string
        }
        Returns: string
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unpost_purchase_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      unpost_sales_invoice: { Args: { p_invoice_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "accountant" | "sales"
      inventory_movement_type:
        | "opening_balance"
        | "purchase"
        | "purchase_return"
        | "sale"
        | "sale_return"
        | "adjustment"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "accountant", "sales"],
      inventory_movement_type: [
        "opening_balance",
        "purchase",
        "purchase_return",
        "sale",
        "sale_return",
        "adjustment",
      ],
    },
  },
} as const
