export type Model = "m3" | "my";
export type Condition = "new" | "used";

export interface Profile {
  id: string;
  enabled: boolean;
  market: string;
  model: Model;
  condition: Condition;
  trim?: string[];
  exteriorColors?: string[];
  interiorColors?: string[];
  maxPriceEur?: number;
  notify: {
    telegram: boolean;
    email: boolean;
  };
}

export interface AppConfig {
  profiles: Profile[];
}

export interface InventoryQuery {
  market: string;
  model: Model;
  condition: Condition;
}

export interface Vehicle {
  id: string;
  vin?: string;
  model: Model;
  condition?: Condition;
  trimCode?: string;
  exteriorCode?: string;
  interiorCode?: string;
  trim?: string;
  exteriorColor?: string;
  interiorColor?: string;
  priceEur?: number;
  location?: string;
  orderUrl: string;
  raw: unknown;
}

export interface Match {
  profile: Profile;
  vehicle: Vehicle;
}

export interface InventoryGateway {
  fetchInventory(query: InventoryQuery): Promise<unknown[]>;
}

export type Channel = "telegram" | "email";
