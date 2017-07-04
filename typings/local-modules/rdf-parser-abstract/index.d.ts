declare module "rdf-parser-abstract" {

    import { RDFStore, RDFGraph, createStore } from 'rdf-ext';

    class AbstractParser {
        constructor();
        parse: (body: string) => Promise<RDFGraph>;
    }
    const parser: typeof AbstractParser;
    export = parser;
}
