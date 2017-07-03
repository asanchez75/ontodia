// import * as $rdf from 'rdflib';
import { RDFStore, RDFGraph, createStore, createGraph, Triple, Node, Literal, NamedNode } from 'rdf-ext';
import * as N3Parser from 'rdf-parser-n3';

import { DataProvider, FilterParams } from '../provider';
import 'whatwg-fetch';
import {
    LocalizedString, Dictionary, ClassModel, LinkType, ElementModel,
    LinkModel, LinkCount, PropertyModel, Property,
} from '../model';

const DEFAULT_STOREG_TYPE = 'text/turtle';
const DEFAULT_STOREG_URI = 'https://ontodia.org/localData.rdf';
const STORAGE_TYPES = [
    'text/turtle',
    'application/rdf+xml',
    'application/xhtml+xml',
    'text/n3',
    'text/html',
    'application/ld+json',
];

function PrefixFactory (prefix: string): ((id: string) => string) {
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
    private checkingElementMap: Dictionary<(Promise<boolean> | boolean)> = {};
    private labelsMap: Dictionary<Triple[]> = {};
    private countMap: Dictionary<number> = {};
    private elementTypes: Dictionary<Triple[]> = {};

    constructor (
        public dataFetching: boolean,
        private prefs: { [id: string]: (id: string) => string },
    ) {
        this.rdfStorage = createStore();
    }

    parseData(data: string, contentType?: string, prefix?: string): Promise<boolean> {
        let resultPromise: Promise<boolean>;
        if (contentType) {
            try {
                resultPromise = new N3Parser().parse(data).then((rdfGraph: any) => {
                    this.rdfStorage.add(prefix || DEFAULT_STOREG_URI, rdfGraph);
                    return true;
                });
            } catch (error) {
                console.error(error);
                resultPromise = Promise.resolve(false);
            }
        } else {
            resultPromise = Promise.resolve(false);
        }

        return resultPromise.then(loaded => {
            if (loaded) {
                return Promise.all([
                    this.rdfStorage.match(
                        null,
                        this.prefs.RDFS('label'),
                        null,
                    ).then(labelTriples => {
                        const labelsList = labelTriples.toArray();
                        for (const triple of labelsList) {
                            const element = triple.subject.nominalValue;
                            if (!this.labelsMap[element]) {
                                this.labelsMap[element] = [];
                            }
                            if (isLiteral(triple.object)) {
                                this.labelsMap[element].push(triple);
                            }
                        }
                        return 0;
                    }),
                    this.rdfStorage.match(
                        null,
                        this.prefs.RDF('type'),
                        null,
                    ).then(typeInstances => {
                        const typeInstMap: Dictionary<string[]> = {};
                        for (const instTriple of typeInstances.toArray()) {
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
                        return 0;
                    }),
                ]).then(() => {
                    return loaded;
                });
            } else {
                return loaded;
            }
        });
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
            if (this.elementTypes[id] || this.labelsMap[id]) {
                return Promise.resolve(true);
            } else {
                if (this.checkingElementMap[id] === undefined) {
                    return this.rdfStorage.match(id, null, null).then(result => {
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
                } else if (this.checkingElementMap[id] instanceof Promise) {
                    return <Promise<boolean>> this.checkingElementMap[id];
                } else {
                    return Promise.resolve(<boolean> this.checkingElementMap[id]);
                }
            }
        } else {
            return Promise.resolve(true);
        }
    }

    getTypeCount(id: string): number {
        return this.countMap[id] || 0;
    }

    private getLabels (id: string): RDFGraph {
        return createGraph(this.labelsMap[id]);
    }

    private getTypes (id: string): RDFGraph {
        return createGraph(this.elementTypes[id]);
    }

    private downloadElement (elementId: string): Promise<boolean> {
        let typePointer = 0;

        const recursivePart = (): Promise<boolean> => {
            const acceptType = STORAGE_TYPES[typePointer++];

            if (acceptType) {
                return fetchFile({
                    url: elementId,
                    headers: {
                        'Accept': acceptType,
                    },
                }).then(body => {
                    if (body) {
                        let parsingError = false;
                        try {
                            return this.parseData(body, acceptType, elementId);
                        } catch (error) {
                            parsingError = true;
                            console.warn('Getting file in ' + acceptType + 'format failed');
                        }
                        if (parsingError) {
                            return recursivePart();
                        } else {
                            const el = elementId;
                            return this.rdfStorage.match(elementId, null, null).then(triples => {
                                return triples.toArray().length > 0;
                            });
                        }
                    } else {
                        return false;
                    }
                });
            } else {
                return Promise.resolve(false);
            }
        };

        const promise = recursivePart().then(result => {
            this.checkingElementMap[elementId] = result;
            return result;
        });
        this.checkingElementMap[elementId] = promise;
        return promise;
    }
}

export class RDFDataProvider implements DataProvider {
    private initStatement: Promise<boolean> | boolean;
    private rdfStorage: RDFCacheableStore;
    private prefs: { [id: string]: (id: string) => string };

    constructor(params: { data: { content: string, type?: string, uri?: string}[], dataFetching?: boolean }) {
        this.prefs = {
            RDF: PrefixFactory('http://www.w3.org/1999/02/22-rdf-syntax-ns#'),
            RDFS: PrefixFactory('http://www.w3.org/2000/01/rdf-schema#'),
            FOAF: PrefixFactory('http://xmlns.com/foaf/0.1/'),
            XSD: PrefixFactory('http://www.w3.org/2001/XMLSchema#'),
            OWL: PrefixFactory('http://www.w3.org/2002/07/owl#'),
        };
        this.rdfStorage = new RDFCacheableStore(params.dataFetching, this.prefs);

        const parsePromises: Promise<boolean>[] = [];

        try {
            params.data = params.data || [];
            for (const data of params.data) {
                parsePromises.push(this.rdfStorage.parseData(data.content, data.type));
            }
        } catch (err) {
            console.error(err);
        }

        this.initStatement = Promise.all(parsePromises).then(parseResults => {
            return parseResults.filter(pr => pr).length > 0 || params.data.length === 0;
        });
    }

    isInitialized(): Promise<boolean> {
        if (this.initStatement instanceof Object) {
            return (<Promise<boolean>> this.initStatement).then(state => {
                this.initStatement = state;
                return this.initStatement;
            });
        } else {
            return Promise.resolve(this.initStatement);
        }
    }

    classTree(): Promise<ClassModel[]> {
        return this.isInitialized().then(state => {
            const rdfClassesQuery =
                this.rdfStorage.match(
                    null,
                    this.prefs.RDF('type'),
                    this.prefs.RDFS('Class'),
                    null,
                );
            const owlClassesQuery =
                this.rdfStorage.match(
                    null,
                    this.prefs.RDF('type'),
                    this.prefs.OWL('Class'),
                );
            const fromRDFTypesQuery =
                this.rdfStorage.match(
                    null,
                    this.prefs.RDF('type'),
                    null,
                );

            const subClassesQuery =
                this.rdfStorage.match(
                    null,
                    this.prefs.RDFS('subClassOf'),
                    null,
                );

            return Promise.all([
                rdfClassesQuery,
                owlClassesQuery,
                fromRDFTypesQuery,
                subClassesQuery,
            ]).then(classesMatrix => {
                const arrays = classesMatrix.map(cm => cm.toArray());
                const classes = arrays[0].map(cl => cl.subject.nominalValue)
                    .concat(arrays[1].map(cl => cl.subject.nominalValue))
                    .concat(arrays[2].map(cl => cl.object.nominalValue));

                const parentsList = arrays[3];
                const parentMap: Dictionary<string[]> = {};
                for (const triple of parentsList) {
                    const subClass = triple.subject.nominalValue;
                    const clazz = triple.object.nominalValue;
                    if (!parentMap[subClass]) {
                        parentMap[subClass] = [];
                    }
                    if (parentMap[subClass].indexOf(clazz) === -1) {
                        parentMap[subClass].push(clazz);
                    }
                }

                const typeInstMap: Dictionary<string[]> = {};
                for (const instTriple of arrays[2]) {
                    const type = instTriple.object.nominalValue;
                    const inst = instTriple.subject.nominalValue;
                    if (!typeInstMap[type]) {
                        typeInstMap[type] = [];
                    }
                    if (typeInstMap[type].indexOf(inst) === -1) {
                        typeInstMap[type].push(inst);
                    }
                }

                const dictionary: Dictionary<ClassModel> = {};
                const firstLevel: Dictionary<ClassModel> = {};

                const labelQueries: Promise<boolean>[] = [];

                for (const cl of classes) {
                    const parents = parentMap[cl] || [];

                    let classElement: ClassModel;
                    let classAlreadyExists = dictionary[cl];
                    if (!classAlreadyExists) {
                        classElement = {
                            id: cl,
                            label: {
                                values: [],
                            },
                            count: this.rdfStorage.getTypeCount(cl),
                            children: [],
                        };
                        labelQueries.push(this.getLabels(cl).then(label => {
                            classElement.label = { values: label };
                            return true;
                        }));
                        dictionary[cl] = classElement;
                        firstLevel[cl] = classElement;
                    } else if (!dictionary[cl].label) {
                        classElement = dictionary[cl];
                        labelQueries.push(this.getLabels(cl).then(label => {
                            classElement.label = { values: label };
                            return true;
                        }));
                    } else {
                        classElement = dictionary[cl];
                    }

                    for (const p of parents) {
                        if (!dictionary[p]) {
                            const parentClassElement: ClassModel = {
                                id: p,
                                label: undefined,
                                count: this.rdfStorage.getTypeCount(p) + 1 + classElement.count,
                                children: [classElement],
                            };
                            dictionary[p] = parentClassElement;
                            firstLevel[p] = parentClassElement;
                        } else if (!classAlreadyExists) {
                            dictionary[p].children.push(classElement);
                            dictionary[p].count += (1 + classElement.count);
                        }
                        delete firstLevel[classElement.id];
                    }
                }
                const result = Object.keys(firstLevel)
                    .map(k => {
                        if (!firstLevel[k].label) {
                            firstLevel[k].label = { values: this.createLabelFromId(firstLevel[k].id) };
                        }
                        return firstLevel[k];
                    },
                );

                return Promise.all(labelQueries).then(responsec => {
                    return result;
                });
            });
        });
    }

    // For lazy loading (not implemented)
    // ====================================================

    propertyInfo(params: { propertyIds: string[] }): Promise<Dictionary<PropertyModel>> {
        return Promise.resolve({});
    }

    classInfo(params: { classIds: string[] }): Promise<ClassModel[]> {
        return Promise.resolve([]);
    }

    linkTypesInfo(params: {linkTypeIds: string[]}): Promise<LinkType[]> {
        return Promise.resolve([]);
    }

    // ====================================================

    linkTypes(): Promise<LinkType[]> {
        const linkTypes: LinkType[] = [];
        const rdfLinks = this.rdfStorage.match(
            undefined,
            this.prefs.RDF('type'),
            this.prefs.RDF('Property'),
        );
        const owlLinks = this.rdfStorage.match(
            undefined,
            this.prefs.RDF('type'),
            this.prefs.OWL('ObjectProperty'),
        );
        return Promise.all([rdfLinks, owlLinks]).then(props => {
            const links = props[0].toArray().concat(props[0].toArray());
            return Promise.all(
                links.map(l =>
                    this.getLabels(l.subject.nominalValue).then(labels => {
                        return {
                            id: l.subject.nominalValue,
                            label: { values: labels },
                            count: this.rdfStorage.getTypeCount(l.subject.nominalValue),
                        };
                    }),
                ),
            );
        });
    }

    elementInfo(params: { elementIds: string[] }): Promise<Dictionary<ElementModel>> {
        const elementInfoResult: Dictionary<ElementModel> = {};

        const queries = params.elementIds.map(
            elementId => this.rdfStorage.checkElement(elementId).then(checked => {
                if (checked) {
                    return this.getElementInfo(elementId);
                } else {
                    return null;
                }
            }),
        );

        return Promise.all(queries).then((fetchedModels) => {
            for (const model of fetchedModels) {
                if (model) {
                    elementInfoResult[model.id] = model;
                }
            }
            return elementInfoResult;
        });
    }

    linksInfo(params: {
        elementIds: string[];
        linkTypeIds: string[];
    }): Promise<LinkModel[]> {

        const queries: Promise<LinkModel[]>[] = [];
        for (const source of params.elementIds) {
            for (const target of params.elementIds) {
                queries.push(Promise.all([
                    this.rdfStorage.checkElement(source),
                    this.rdfStorage.checkElement(target),
                ]).then(([sourceExist, targetExist]) => {
                    return this.rdfStorage.match(source, undefined, target).then(linkTriple => {
                        return linkTriple.toArray().map(lt => ({
                            linkTypeId: lt.predicate.nominalValue,
                            sourceId: source,
                            targetId: target,
                        }));
                    });
                }));
            }
        }

        return Promise.all(queries).then((fetchedModelsMatrix) => {
            const linkInfoResult: LinkModel[] = [];
            for (const fetchedModels of fetchedModelsMatrix) {
                for (const model of fetchedModels) {
                    if (model) {
                        linkInfoResult.push(model);
                    }
                }
            }
            return linkInfoResult;
        });
    }

    linkTypesOf(params: { elementId: string; }): Promise<LinkCount[]> {
        const links: LinkCount[] = [];
        const element = params.elementId;
        const linkMap: Dictionary<LinkCount> = {};

        const inElementsQuery =
            this.rdfStorage.match(null, null, element).then(inElementsTriples => {

                const inElements = inElementsTriples.toArray()
                    .filter(t => isNamedNode(t.subject))
                    .map(triple => triple.predicate);

                for (const el of inElements) {
                    if (!linkMap[el.nominalValue]) {
                        linkMap[el.nominalValue] = {
                            id: el.nominalValue,
                            inCount: 1,
                            outCount: 0,
                        };
                        links.push(linkMap[el.nominalValue]);
                    } else {
                        linkMap[el.nominalValue].inCount++;
                    }
                }
            });

        const outElementsQuery =
            this.rdfStorage.match(element, null, null).then(outElementsTriples => {
                const outElements = outElementsTriples.toArray()
                    .filter(t => isNamedNode(t.object))
                    .map(triple => triple.predicate);

                for (const el of outElements) {
                    if (!linkMap[el.nominalValue]) {
                        linkMap[el.nominalValue] = {
                            id: el.nominalValue,
                            inCount: 0,
                            outCount: 1,
                        };
                        links.push(linkMap[el.nominalValue]);
                    } else {
                        linkMap[el.nominalValue].outCount++;
                    }
                }
            });

        return Promise.all([inElementsQuery, outElementsQuery]).then(() => {
            return links;
        });
    };

    linkElements(params: {
        elementId: string;
        linkId: string;
        limit: number;
        offset: number;
        direction?: 'in' | 'out';
    }): Promise<Dictionary<ElementModel>> {
        return this.filter({
            refElementId: params.elementId,
            refElementLinkId: params.linkId,
            linkDirection: params.direction,
            limit: params.limit,
            offset: params.offset,
            languageCode: ''});
    }

    filter(params: FilterParams): Promise<Dictionary<ElementModel>> {
        if (params.limit === 0) { params.limit = 100; }

        const offsetIndex = params.offset;
        const limitIndex = params.offset + params.limit;

        let elementsPromise;
        if (params.elementTypeId) {
            elementsPromise =
                this.rdfStorage.match(
                    undefined,
                    this.prefs.RDF('type'),
                    params.elementTypeId,
                ).then(elementTriples => {
                    return Promise.all(
                        elementTriples.toArray()
                            .filter((t, index) => filter(t.subject, index))
                            .map(
                                el => this.getElementInfo(el.subject.nominalValue, true),
                            ),
                    );
                });
        } else if (params.refElementId && params.refElementLinkId) {
            const refEl = params.refElementId;
            const refLink = params.refElementLinkId;
            if (params.linkDirection === 'in') {
                elementsPromise =
                    this.rdfStorage.match(null, refLink, refEl).then(elementTriples => {
                        return Promise.all(
                            elementTriples.toArray()
                                .filter((t, index) => filter(t.subject, index))
                                .map(el => this.getElementInfo(el.subject.nominalValue, true)),
                        );
                    });
            } else {
                elementsPromise =
                    this.rdfStorage.match(refEl, refLink, null).then(elementTriples => {
                        return Promise.all(
                            elementTriples.toArray()
                                .filter((t, index) => filter(t.object, index))
                                .map(el => this.getElementInfo(el.object.nominalValue, true)),
                        );
                    });
            }
        } else if (params.refElementId) {
            const refEl = params.refElementId;

            elementsPromise = Promise.all([
                this.getElementInfo(refEl, true),
                this.rdfStorage.match(null, null, refEl, null, null, limitIndex).then(elementTriples => {
                    return Promise.all(
                        elementTriples.toArray()
                            .filter((t, index) => filter(t.subject, index))
                            .map(el => this.getElementInfo(el.subject.nominalValue, true)),
                    );
                }),
                this.rdfStorage.match(refEl, null, null).then(elementTriples => {
                    return Promise.all(
                        elementTriples.toArray()
                            .filter((t, index) => filter(t.object, index))
                            .map(el => this.getElementInfo(el.object.nominalValue, true)),
                    );
                }),
            ]).then(([refElement, inRelations, outRelations]) => {
                return [refElement].concat(inRelations).concat(outRelations);
            });

        } else if (params.text) {
            elementsPromise =
                this.rdfStorage.match(null, null, null).then(elementTriples => {
                    const triples = elementTriples.toArray();
                    const objectPromises = triples.filter((t, index) => filter(t.object, index))
                            .map(el => this.getElementInfo(el.object.nominalValue, true));
                    const subjectPromises = triples.filter((t, index) => filter(t.subject, index))
                            .map(el => this.getElementInfo(el.subject.nominalValue, true));
                    return Promise.all(objectPromises.concat(subjectPromises));
                });
        } else {
            return Promise.resolve({});
        }

        function filter (node: Node, index: number) {
            return isNamedNode(node) &&
                offsetIndex <= index &&
                index < limitIndex;
        }

        return elementsPromise.then(elements => {
            const result: Dictionary<ElementModel> = {};
            const key = (params.text ? params.text.toLowerCase() : null);

            for (const el of elements) {
                if (key) {
                    let acceptableKey = false;
                    for (const label of el.label.values) {
                        acceptableKey = acceptableKey || label.text.toLowerCase().indexOf(key) !== -1;
                    }
                    if (acceptableKey) {
                        result[el.id] = el;
                    }
                } else {
                    result[el.id] = el;
                }
            }
            return result;
        });
    };

    private getElementInfo(id: string, shortInfo?: boolean): Promise<ElementModel> {
        return Promise.all([
            this.getTypes(id),
            (!shortInfo ? this.getProps(id) : Promise.resolve({})),
            this.getLabels(id),
        ]).then(([types, props, labels]) => {
            return {
                id: id,
                types: types,
                label: { values: labels },
                properties: props,
            };
        });
    };

    private createLabelFromId (id: string): LocalizedString[] {
        let label;
        if (id) {
            const urlParts = id.split('/');
            const sharpParts = urlParts[urlParts.length - 1].split('#');
            label = sharpParts[sharpParts.length - 1];
        } else {
            label = '';
        }
        return [{
                text: label,
                lang: '',
            }];
    }

    private getLabels (id: string): Promise<LocalizedString[]> {
        return this.rdfStorage.match(id, this.prefs.RDFS('label'), null).then(labelTriples => {
            const tripleArray = labelTriples.toArray();
            return tripleArray.length > 0 ? labelTriples.toArray().map(l => ({
                text: l.object.nominalValue,
                lang: isLiteral(l.object) ? l.object.language || '' : '',
            })) : this.createLabelFromId(id);
        });
    }

    private getProps (el: string): Promise<Dictionary<Property>> {
        return this.rdfStorage.match(el, null, null).then(propsGraph => {
            const props: Dictionary<Property> = {};
            const propTriples = propsGraph.toArray();

            for (const statemet of propTriples) {
                if (
                    isLiteral(statemet.object) &&
                    statemet.predicate.nominalValue !== this.prefs.RDFS('label')
                ) {
                    props[statemet.predicate.nominalValue] = {
                        type: 'string',
                        values: [{
                            text: statemet.object.nominalValue,
                            lang: statemet.object.language || '',
                        }],
                    };
                }
            }
            return props;
        });
    }

    private getTypes (el: string): Promise<string[]> {
        return this.rdfStorage.match(
            el,
            this.prefs.RDF('type'),
            undefined,
        ).then(typeTriples => {
            return typeTriples.toArray().map(t => t.object.nominalValue);
        });
    }
}

export default RDFDataProvider;

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
