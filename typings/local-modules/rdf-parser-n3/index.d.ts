declare module "rdf-parser-n3" {

    import { RDFStore, RDFGraph, createStore } from 'rdf-ext';

    class N3Parser {
        constructor();
        parse: (body: string) => Promise<RDFGraph>;
    }
    const parser: typeof N3Parser;
    export = parser;
}
