export interface BindConfig {
    value?: string;
    request?: ValueExtractor;
}

export interface ValueExtractor {
    header?: string;
    body?: string;
}
