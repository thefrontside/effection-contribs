import type { Operation, Stream } from "npm:effection@4.0.0-alpha.3";

export interface Store {
  location: URL;
  write(key: string, data: unknown): Operation<void>;
  append(key: string, data: unknown): Operation<void>;
  read<T>(key: string): Stream<T, void>;
  has(key: string): Operation<boolean>;
  find<T>(glob: string): Stream<T, void>;
  clear(): Operation<void>;
}

export interface StoreConstructorOptions {
  location: URL | string;
}
