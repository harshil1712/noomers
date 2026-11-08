// Use a simpler approach with a comment to explain the type
declare global {
    interface Window {
        noomers: {
            init: (opts: any) => void;
            trackPageview: (opts?: any) => Promise<void>;
            cleanup: () => void;
        };
    }
}

export {};
