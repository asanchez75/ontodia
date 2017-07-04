declare module "rdf-parser-rdfxml" {

    import { RDFStore, RDFGraph, createStore } from 'rdf-ext';
    import * as AbstractParser from 'rdf-parser-abstract';
    
    class RdfXmlParser extends AbstractParser {
        constructor();
        parse: (body: string) => Promise<RDFGraph>;
    }
    const parser: typeof RdfXmlParser;
    export = parser;
}
