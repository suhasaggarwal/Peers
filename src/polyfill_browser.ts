import * as p from 'process';

if (typeof process == 'undefined') {
    const obj = typeof globalThis == 'object' ? globalThis : typeof window == 'object' ? window : self;
    Object.defineProperty(obj, 'process', {
        value: p,
        configurable: true,
        writable: true,
    });
}

export const wrtc = undefined;
