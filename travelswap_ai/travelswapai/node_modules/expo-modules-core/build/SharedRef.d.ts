import { EventsMap } from '../src/ts-declarations/EventEmitter';
import type { ExpoGlobal } from '../src/ts-declarations/global';
export type SharedRef<TNativeRefType extends string = 'unknown', TEventsMap extends EventsMap = Record<never, never>> = typeof ExpoGlobal.SharedRef<TNativeRefType, TEventsMap>;
export declare const SharedRef: typeof ExpoGlobal.SharedRef;
//# sourceMappingURL=SharedRef.d.ts.map