import { RDFStore, RDFGraph, createStore, createGraph, Triple, Node, Literal, NamedNode } from 'rdf-ext';
import * as N3Parser from 'rdf-parser-n3';
import * as RdfXmlParser from 'rdf-parser-rdfxml';
import * as JsonLdParser from 'rdf-parser-jsonld';

import 'whatwg-fetch';
import { Dictionary } from '../model';

export const MIME_TYPES = [
    'text/turtle',
    'application/rdf+xml',
    // 'application/xhtml+xml',
    // 'text/n3',
    // 'text/html',
    'application/ld+json',
];

export class RDFParser {
    constructor() {
        /* */
    }

    parse (body: string, mimeType?: string): Promise<RDFGraph> {
        if (mimeType) {
            if (mimeType === 'application/rdf+xml') {
                body = body.replace(/Collection/ig, 'Collection1');
            }
            return getParser(mimeType).parse(body);
        } else {
            return this.tryToGuessMimeType(body);
        }
    }

    private tryToGuessMimeType (body: string): Promise<RDFGraph> {
        let i = 0;

        const recursion = (): Promise<RDFGraph> => {
            if (i < MIME_TYPES.length) {
                const mimeType = MIME_TYPES[i++];
                try {
                    return getParser(mimeType).parse(body).catch(() => {
                        /* silent */
                        return recursion();
                    });
                } catch (error) {
                    return recursion();
                }
            } else {
                throw 'Unknow mime type';
            }
        };

        return recursion();
    }
}

export default RDFParser;

export function getParser(mimeType: string) {
    switch (mimeType) {
        case 'text/turtle':
            return new N3Parser();
        case 'application/rdf+xml' :
            return new RdfXmlParser();
        case 'application/ld+json' :
            return new JsonLdParser();
        default:
            return new N3Parser();
    }
}
