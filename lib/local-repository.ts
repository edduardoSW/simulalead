import type { LocalData } from "./local-domain";
export interface LocalRepository { load():Promise<LocalData>; save(data:LocalData):Promise<void> }
