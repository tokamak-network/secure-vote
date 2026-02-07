declare module 'circomlibjs' {
  type PoseidonFn = {
    (inputs: any[]): any;
    F: {
      toObject(val: any): any;
      e(val: any): any;
    };
  };
  export type Poseidon = PoseidonFn;
  export function buildPoseidon(): Promise<Poseidon>;
}
declare module 'snarkjs';
