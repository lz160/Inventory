export type StocktakeStatus = 'open' | 'submitted';

export interface StocktakeHead {
  Id: number;
  Name: string;
  CountDate: string;
  CreatedBy: string;
  Status: StocktakeStatus;
  SyncedToG1: string | null;
}

export interface StocktakeListRow extends StocktakeHead {
  LineCount: number;
  DiffCount: number;
}

export interface StocktakeLine {
  Id?: number;
  StocktakeId?: number;
  Barcode: string;
  Nazov: string | null;
  SystemQty: number;
  CountedQty: number;
  Variance: number;
  WarningAt: number | null;
  Notes?: string | null;
}

export interface UpsertStocktakeLineInput {
  barcode: string;
  countedQty: number;
  warningAt?: number | null;
  notes?: string | null;
}
