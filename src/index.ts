import * as p from 'process';
import 'core-js/features/global-this';

if (typeof process == 'undefined') {
    Object.defineProperty(globalThis, 'process', {
        value: p,
        configurable: true,
        writable: true,
    });
}

export * from './encoding';
export * from './peer';
