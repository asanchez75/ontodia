declare module "rdf-parser-n3" {

    import { RDFStore, RDFGraph, createStore } from 'rdf-ext';
    import * as AbstractParser from 'rdf-parser-abstract';

    class N3Parser extends AbstractParser {
        constructor();
        parse: (body: string) => Promise<RDFGraph>;
    }
    const parser: typeof N3Parser;
    export = parser;
}
