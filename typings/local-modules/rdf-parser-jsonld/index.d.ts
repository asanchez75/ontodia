declare module "rdf-parser-jsonld" {

    import { RDFStore, RDFGraph, createStore } from 'rdf-ext';
    import * as AbstractParser from 'rdf-parser-abstract';

    class JsonLdParser extends AbstractParser {
        constructor();
        parse: (body: string) => Promise<RDFGraph>;
    }
    const parser: typeof JsonLdParser;
    export = parser;
}
