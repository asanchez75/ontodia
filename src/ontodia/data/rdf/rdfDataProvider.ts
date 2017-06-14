import * as $rdf from 'rdflib';
import { DataProvider, FilterParams } from '../provider';
import {
    LocalizedString, Dictionary, ClassModel, LinkType, ElementModel,
    LinkModel, LinkCount, PropertyModel, Property,
} from '../model';

const DEFAULT_STOREG_TYPE = 'text/turtle';
const DEFAULT_STOREG_URI = 'https://ontodia.org/localData.rdf';

export class RDFDataProvider implements DataProvider {
    private rdfStore: $rdf.IndexedFormula;
    private prefs: any;

    constructor(params: { data: { content: string, type?: string, uri?: string}[] }) {
        this.rdfStore = $rdf.graph();
        try {
            for (const data of params.data) {
                $rdf.parse(
                    data.content,
                    this.rdfStore, data.uri || DEFAULT_STOREG_URI,
                    data.type || DEFAULT_STOREG_TYPE,
                );
            }
            this.prefs = {
                RDF: $rdf.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#'),
                RDFS: $rdf.Namespace('http://www.w3.org/2000/01/rdf-schema#'),
                FOAF: $rdf.Namespace('http://xmlns.com/foaf/0.1/'),
                XSD: $rdf.Namespace('http://www.w3.org/2001/XMLSchema#'),
                OWL: $rdf.Namespace('http://www.w3.org/2002/07/owl#'),
            };
        } catch (err) {
            console.error(err);
        }
    }

    classTree(): Promise<ClassModel[]> {
        const rdfClasses = this.rdfStore.each(undefined, this.prefs.RDF('type'), this.prefs.RDFS('Class'));
        const owlClasses = this.rdfStore.each(undefined, this.prefs.RDF('type'), this.prefs.OWL('Class'));
        const fromRDFTypes =
            this.rdfStore.statementsMatching(undefined, this.prefs.RDF('type'), undefined)
                .map(statemet => statemet.object);

        const classes = rdfClasses.concat(owlClasses).concat(fromRDFTypes);
        const dictionary: Dictionary<ClassModel> = {};
        const firstLevel: Dictionary<ClassModel> = {};

        for (const cl of classes) {
            const parents = this.rdfStore.each(
                cl,
                this.prefs.RDFS('subClassOf'),
                undefined,
            );

            let classElement: ClassModel;
            let classAlreadyExists = dictionary[cl.value];
            if (!classAlreadyExists) {
                classElement = {
                    id: cl.value,
                    label: { values: this.getLabels(cl) },
                    count: this.getCount(cl),
                    children: [],
                };
                dictionary[cl.value] = classElement;
                firstLevel[cl.value] = classElement;
            } else if (!dictionary[cl.value].label) {
                classElement = dictionary[cl.value];
                classElement.label = { values: this.getLabels(cl) };
            } else {
                classElement = dictionary[cl.value];
            }

            for (const p of parents) {
                if (!dictionary[p.value]) {
                    const parentClassElement: ClassModel = {
                        id: p.value,
                        label: undefined,
                        count: this.getCount(p) + 1 + classElement.count,
                        children: [classElement],
                    };
                    dictionary[p.value] = parentClassElement;
                    firstLevel[p.value] = parentClassElement;
                } else if (!classAlreadyExists) {
                    dictionary[p.value].children.push(classElement);
                    dictionary[p.value].count += (1 + classElement.count);
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
        return Promise.resolve(result);
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
        const rdfLinks = this.rdfStore.each(undefined, this.prefs.RDF('type'), this.prefs.RDF('Property'));
        const owlLinks = this.rdfStore.each(undefined, this.prefs.RDF('type'), this.prefs.OWL('ObjectProperty'));
        const links = rdfLinks.concat(owlLinks);
        const linkTypes: LinkType[] = [];
        const linkMap: Dictionary<LinkType> = {};
        for (const l of links) {
            if (!linkMap[l.value]) {
                linkMap[l.value] = {
                    id: l.value,
                    label: { values: this.getLabels(l) },
                    count: this.getCount(l),
                };
                linkTypes.push(linkMap[l.value]);
            }
        }
        return Promise.resolve(linkTypes);
    }

    elementInfo(params: { elementIds: string[]; }): Promise<Dictionary<ElementModel>> {
        const result: Dictionary<ElementModel> = {};
        for (const id of params.elementIds) {
            const el = $rdf.sym(id);
            if (this.rdfStore.any(el, undefined, undefined)) {
                result[id] = {
                    id: id,
                    types: this.getTypes(el),
                    label: { values: this.getLabels(el) },
                    properties: this.getProps(el),
                };
            }
        }
        return Promise.resolve(result);
    }

    linksInfo(params: {
        elementIds: string[];
        linkTypeIds: string[];
    }): Promise<LinkModel[]> {
        const links: LinkModel[] = [];

        for (const sourceId of params.elementIds) {
            const source = $rdf.sym(sourceId);
            for (const targetId of params.elementIds) {
                const target = $rdf.sym(targetId);
                const obtainedlinks = this.rdfStore.each(source, undefined, target);
                for (const l of obtainedlinks) {
                    links.push({
                        linkTypeId: l.value,
                        sourceId: sourceId,
                        targetId: targetId,
                    });
                }
            }
        }

        return Promise.resolve(links);
    }

    linkTypesOf(params: { elementId: string; }): Promise<LinkCount[]> {
        const element = $rdf.sym(params.elementId);
        const links: LinkCount[] = [];
        const linkMap: Dictionary<LinkCount> = {};

        const inElements =
            this.rdfStore.statementsMatching(undefined, undefined, element)
                .filter(st => st.subject.termType === 'NamedNode');
        const outElements =
            this.rdfStore.statementsMatching(element, undefined, undefined)
                .filter(st => st.object.termType === 'NamedNode');

        for (const el of inElements) {
            if (!linkMap[el.predicate.value]) {
                linkMap[el.predicate.value] = {
                    id: el.predicate.value,
                    inCount: 1,
                    outCount: 0,
                };
                links.push(linkMap[el.predicate.value]);
            } else {
                linkMap[el.predicate.value].inCount++;
            }
        }
        for (const el of outElements) {
            if (!linkMap[el.predicate.value]) {
                linkMap[el.predicate.value] = {
                    id: el.predicate.value,
                    inCount: 0,
                    outCount: 1,
                };
                links.push(linkMap[el.predicate.value]);
            } else {
                linkMap[el.predicate.value].outCount++;
            }
        }
        return Promise.resolve(links);
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

        const result: Dictionary<ElementModel> = {};
        let elements;
        if (params.elementTypeId) {
            elements =
                this.rdfStore.each(
                    undefined,
                    this.prefs.RDF('type'),
                    $rdf.sym(params.elementTypeId),
                ).map(el => this.namedNode2ElementModel(el));
        } else if (params.refElementId && params.refElementLinkId) {
            const refEl = $rdf.sym(params.refElementId);
            const refLink = $rdf.sym(params.refElementLinkId);
            if (params.linkDirection === 'in') {
                elements =
                    this.rdfStore.each(undefined, refLink, refEl)
                        .filter(el => el.termType === 'NamedNode')
                        .map(el => this.namedNode2ElementModel(el));
            } else {
                elements =
                    this.rdfStore.each(refEl, refLink, undefined)
                        .filter(el => el.termType === 'NamedNode')
                        .map(el => this.namedNode2ElementModel(el));
            }
        } else if (params.refElementId) {
            const rdfEl = $rdf.sym(params.refElementId);
            const inElements =
                this.rdfStore.statementsMatching(undefined, undefined, rdfEl)
                    .filter(st => st.subject.termType === 'NamedNode')
                    .map(st => this.namedNode2ElementModel(st.subject));
            const outElements =
                this.rdfStore.statementsMatching(rdfEl, undefined, undefined)
                    .filter(st => st.object.termType === 'NamedNode')
                    .map(st => this.namedNode2ElementModel(st.object));
            elements = inElements.concat(outElements);
        } else if (params.text) {
            elements = this.rdfStore.each(undefined, undefined, undefined)
                    .filter(el => el.termType === 'NamedNode')
                    .map(el => this.namedNode2ElementModel(el));
        } else {
            return Promise.resolve({});
        }

        function filter (e: ElementModel) {
            if (params.text) {
                const key = params.text.toLowerCase();
                const matchId = e.id.toLowerCase().indexOf(key) !== -1;
                let matchLabel = false;
                for (const label of e.label.values) {
                    matchLabel = matchLabel || label.text.toLowerCase().indexOf(key) !== -1;
                }
                return matchId || matchLabel;
            } else {
                return true;
            }
        }

        elements = elements.filter(filter).slice(params.offset, params.offset + params.limit);
        for (const el of elements) {
            result[el.id] = el;
        }
        return Promise.resolve(result);
    };

    private namedNode2ElementModel (el: $rdf.NamedNode): ElementModel {
        return {
            id: el.value,
            types: this.getTypes(el),
            label: { values: this.getLabels(el) },
            properties: this.getProps(el),
        };
    }

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

    private getLabels (el: $rdf.NamedNode): LocalizedString[] {
        const labels = this.rdfStore.each(
            el,
            this.prefs.RDFS('label'),
            undefined,
        ).map(l => ({
            text: l.value,
            lang: l.language,
        }));
        return labels.length > 0 ? labels : this.createLabelFromId(el.value);
    }

    private getProps (el: $rdf.NamedNode): Dictionary<Property> {
        const props: Dictionary<Property> = {};
        const propsList = this.rdfStore.statementsMatching(el, undefined, undefined);
        for (const statemet of propsList) {
            if (
                statemet.object.termType === 'Literal' &&
                statemet.predicate.value !== this.prefs.RDFS('label').value
            ) {
                props[statemet.predicate.value] = {
                    type: 'string',
                    values: [{
                        text: statemet.object.value,
                        lang: statemet.object.language,
                    }],
                };
            }
        }
        return props;
    }

    private getTypes (el: $rdf.NamedNode): string[] {
        return this.rdfStore.each(
            el,
            this.prefs.RDF('type'),
            undefined,
        ).map(t => t.value);
    }

    private getCount (el: $rdf.NamedNode): number {
        const count = this.rdfStore.each(
            undefined,
            this.prefs.RDF('type'),
            el,
        ).length;
        return count === 0 ? undefined : count;
    }
}

export default RDFDataProvider;
