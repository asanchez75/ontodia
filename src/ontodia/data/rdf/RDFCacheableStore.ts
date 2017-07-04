import { RDFStore, RDFGraph, createStore, createGraph, Triple, Node, Literal, NamedNode } from 'rdf-ext';

import 'whatwg-fetch';
import { Dictionary } from '../model';
import { RDFParser, MIME_TYPES } from './RDFParser';

const DEFAULT_STOREG_TYPE = 'text/turtle';
const DEFAULT_STOREG_URI = 'https://ontodia.org/localData.rdf';

export function PrefixFactory (prefix: string): ((id: string) => string) {
    const lastSymbol = prefix[prefix.length - 1];
    const _prefix = lastSymbol === '/' || lastSymbol === '#' ? prefix : prefix + '/';
    return (id: string) => {
        return _prefix + id;
    };
}

export function isLiteral(el: Node): el is Literal {
    return el.interfaceName === 'Literal';
}

export function isNamedNode(el: Node): el is NamedNode {
    return el.interfaceName === 'NamedNode';
}

export class RDFCacheableStore {
    private rdfStorage: RDFStore;
    private checkingElementMap: Dictionary<Promise<boolean>> = {};
    private fetchingFileCatche: Dictionary<Promise<boolean>> = {};
    private labelsMap: Dictionary<Triple[]> = {};
    private countMap: Dictionary<number> = {};
    private elementTypes: Dictionary<Triple[]> = {};
    private prefs: { [id: string]: (id: string) => string };

    constructor (
        public dataFetching: boolean,
    ) {
        this.rdfStorage = createStore();
        this.prefs = {
            RDF: PrefixFactory('http://www.w3.org/1999/02/22-rdf-syntax-ns#'),
            RDFS: PrefixFactory('http://www.w3.org/2000/01/rdf-schema#'),
            FOAF: PrefixFactory('http://xmlns.com/foaf/0.1/'),
            XSD: PrefixFactory('http://www.w3.org/2001/XMLSchema#'),
            OWL: PrefixFactory('http://www.w3.org/2002/07/owl#'),
        };
    }

    parseData(data: string, contentType?: string, prefix?: string): Promise<boolean> {
        let resultPromise: Promise<boolean>;
        try {
            resultPromise = new RDFParser().parse(data, contentType).then((rdfGraph: any) => {
                this.rdfStorage.add(prefix || DEFAULT_STOREG_URI, rdfGraph);
                return this.enrichMaps(rdfGraph);
            });
        } catch (error) {
            console.error(error);
            resultPromise = Promise.resolve(false);
        }

        return resultPromise;
    }

    match(
        subject?: string,
        predicate?: string,
        object?: string,
        iri?: string,
        callback?: (...args: any[]) => void,
        limit?: number,
    ): Promise<RDFGraph> {
        if (subject && predicate === this.prefs.RDFS('label') && !object) {
            return Promise.resolve(this.getLabels(subject));
        } else if (subject && predicate === this.prefs.RDF('type') && !object) {
            return Promise.resolve(this.getTypes(subject));
        } else {
            return this.rdfStorage.match(
                subject,
                predicate,
                object,
                iri,
                callback,
                limit,
            );
        }
    }

    checkElement(id: string): Promise<boolean> {
        if (this.dataFetching) {
            if (this.labelsMap[id]) {
                return Promise.resolve(true);
            } else {
                if (!this.checkingElementMap[id]) {
                    this.checkingElementMap[id] = this.rdfStorage.match(id, null, null).then(result => {
                        const resultArray = result.toArray();
                        if (resultArray.length === 0) {
                            return this.downloadElement(id).then(isElementDownloaded => {
                                if (isElementDownloaded) {
                                    return true;
                                } else {
                                    return null;
                                }
                            });
                        } else if (resultArray.length !== 0) {
                            return true;
                        } else {
                            return false;
                        }
                    });
                    return this.checkingElementMap[id];
                } else {
                    return this.checkingElementMap[id];
                }
            }
        } else {
            return Promise.resolve(true);
        }
    }

    getTypeCount(id: string): number {
        return this.countMap[id] || 0;
    }

    private enrichMaps(newGraph: RDFGraph): boolean {
        const labelsList = newGraph.match(
            null,
            this.prefs.RDFS('label'),
            null,
        ).toArray();

        for (const triple of labelsList) {
            const element = triple.subject.nominalValue;
            if (!this.labelsMap[element]) {
                this.labelsMap[element] = [];
            }
            if (isLiteral(triple.object)) {
                this.labelsMap[element].push(triple);
            }
        }

        const typeInstances = newGraph.match(
            null,
            this.prefs.RDF('type'),
            null,
        ).toArray();
        const typeInstMap: Dictionary<string[]> = {};
        for (const instTriple of typeInstances) {
            const type = instTriple.object.nominalValue;
            const inst = instTriple.subject.nominalValue;
            if (!typeInstMap[type]) {
                typeInstMap[type] = [];
            }
            if (!this.elementTypes[inst]) {
                this.elementTypes[inst] = [];
            }
            if (typeInstMap[type].indexOf(inst) === -1) {
                typeInstMap[type].push(inst);
            }
            this.elementTypes[inst].push(instTriple);
        }
        Object.keys(typeInstMap).forEach(key => this.countMap[key] = typeInstMap[key].length);

        return true;
    }

    private getLabels (id: string): RDFGraph {
        return createGraph(this.labelsMap[id]);
    }

    private getTypes (id: string): RDFGraph {
        return createGraph(this.elementTypes[id]);
    }

    private downloadElement (elementId: string): Promise<boolean> {
        const sharpIndex = elementId.indexOf('#');
        const fileUrl = sharpIndex !== -1 ? elementId.substr(0, sharpIndex) : elementId;
        let typePointer = 0;

        const recursivePart = (): Promise<boolean> => {
            const acceptType = MIME_TYPES[typePointer++];

            if (acceptType && (elementId.startsWith('http') || elementId.startsWith('file'))) {
                return fetchFile({
                    url: elementId,
                    headers: {
                        'Accept': acceptType,
                    },
                }).then(body => {
                    if (body) {
                        return this.parseData(body, acceptType, elementId).then(parsed => {
                            if (!parsed) {
                                console.warn('Getting file in ' + acceptType + ' format failed');
                                return recursivePart();
                            } else {
                                const el = elementId;
                                return this.rdfStorage.match(elementId, null, null).then(triples => {
                                    return triples.toArray().length > 0;
                                });
                            }
                        }).catch(error => {
                            console.warn('Getting file in ' + acceptType + ' format failed');
                            return recursivePart();
                        });
                    } else {
                        return false;
                    }
                });
            } else {
                return Promise.resolve(false);
            }
        };

        if (!this.fetchingFileCatche[fileUrl]) {
            this.fetchingFileCatche[fileUrl] = recursivePart();
        }
        return <Promise<boolean>> this.fetchingFileCatche[fileUrl];
    }
}

export default RDFCacheableStore;

function fetchFile(params: {
    url: string,
    headers?: any,
}) {
    return fetch(
        '/lod-proxy/' + params.url,
        {
            method: 'GET',
            credentials: 'same-origin',
            mode: 'cors',
            cache: 'default',
            headers: params.headers || {
                'Accept': 'application/rdf+xml',
            },
        },
    ).then(response => {
        if (response.ok) {
            return response.text();
        } else {
            const error = new Error(response.statusText);
            (<any> error).response = response;
            console.error(error);
            return undefined;
        }
    }).catch(error => {
        console.error(error);
        return undefined;
    });
}
