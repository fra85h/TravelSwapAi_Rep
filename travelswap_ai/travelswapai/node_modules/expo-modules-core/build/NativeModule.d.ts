import type { EventsMap } from '../src/ts-declarations/EventEmitter';
import type { ExpoGlobal } from '../src/ts-declarations/global';
export type NativeModule<TEventsMap extends EventsMap = Record<never, never>> = typeof ExpoGlobal.NativeModule<EventsMap>;
export declare const NativeModule: typeof ExpoGlobal.NativeModule;
//# sourceMappingURL=NativeModule.d.ts.map