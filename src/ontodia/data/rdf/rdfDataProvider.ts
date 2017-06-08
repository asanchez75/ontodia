import 'whatwg-fetch';
import * as $rdf from 'rdflib';
import { DataProvider, FilterParams } from '../provider';
import {
    LocalizedString, Dictionary, ClassModel, LinkType, ElementModel,
    LinkModel, LinkCount, PropertyModel, Property,
} from '../model';
import getData from './getData';

const RAW_RDF_DATA = getData();

export class RDFDataProvider implements DataProvider {
    private rdfStore: $rdf.IndexedFormula;
    private storeURI: string;
    private prefs: any;

    constructor() {
        this.storeURI = 'https://ontodia.org/testData.ttl';
        this.rdfStore = $rdf.graph();
        try {
            $rdf.parse(RAW_RDF_DATA, this.rdfStore, this.storeURI, 'text/turtle');
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

        const classes = rdfClasses.concat(owlClasses);
        const dictionary: Dictionary<ClassModel> = {};
        const firstLevel: Dictionary<ClassModel> = {};

        for (const cl of classes) {
            const labels = this.getLabels(cl);

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
                    label: { values: labels },
                    count: this.getCount(cl),
                    children: [],
                };
                dictionary[cl.value] = classElement;
                firstLevel[cl.value] = classElement;
            } else if (dictionary[cl.value].count === -1) {
                classElement = dictionary[cl.value];
                classElement.count = 1;
                classElement.label = { values: labels };
            } else {
                classElement = dictionary[cl.value];
                classElement.count++;
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

        return Promise.resolve(
            Object.keys(firstLevel)
                .map(k => {
                    if (!firstLevel[k].label) {
                        firstLevel[k].label = { values: this.createLabelFromId(firstLevel[k].id) };
                    }
                    return firstLevel[k];
                }),
            );
    }

    propertyInfo(params: { propertyIds: string[] }): Promise<Dictionary<PropertyModel>> {
        return Promise.resolve({});
    }

    classInfo(params: { classIds: string[] }): Promise<ClassModel[]> {
        return Promise.resolve([]);
    }

    linkTypesInfo(params: {linkTypeIds: string[]}): Promise<LinkType[]> {
        const idList = $rdf.list(params.linkTypeIds);
        const rdfLinks = this.rdfStore.each(idList, this.prefs.RDF('type'), this.prefs.RDF('Property'));
        const owlLinks = this.rdfStore.each(idList, this.prefs.RDF('type'), this.prefs.OWL('ObjectProperty'));
        const links = rdfLinks.concat(owlLinks);

        const result = links.map(l => ({
            id: l.value,
            label: { values: this.getLabels(l) },
            count: this.getCount(l),
        }));

        return Promise.resolve(result);
    }

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
            result[id] = {
                id: id,
                types: this.getTypes(el),
                label: { values: this.getLabels(el) },
                properties: this.getProps(el),
            };
        }
        return Promise.resolve(result);
    }

    private enrichedElementsInfo(
        elementsInfo: Dictionary<ElementModel>,
        types: string[]
    ): Promise<Dictionary<ElementModel>> {
        return Promise.resolve({});
    }

    private prepareElementsImage(
        elementsInfo: Dictionary<ElementModel>,
    ): Promise<Dictionary<ElementModel>> {
        return Promise.resolve({});
    }

    linksInfo(params: {
        elementIds: string[];
        linkTypeIds: string[];
    }): Promise<LinkModel[]> {
        return Promise.resolve([]);
    }

    linkTypesOf(params: { elementId: string; }): Promise<LinkCount[]> {
        return Promise.resolve([]);
    };


    linkElements(params: {
        elementId: string;
        linkId: string;
        limit: number;
        offset: number;
        direction?: 'in' | 'out';
    }): Promise<Dictionary<ElementModel>> {
        return Promise.resolve({});
    }

    filter(params: FilterParams): Promise<Dictionary<ElementModel>> {
        return Promise.resolve({});
    };


    // Helpers

    private createLabelFromId (id: string): LocalizedString[] {
        const urlParts = id.split('/');
        const sharpParts = urlParts[urlParts.length - 1].split('#');
        return [{
                text: sharpParts[sharpParts.length - 1],
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

    private getProps (el: $rdf.NamedNode): { [id: string]: Property } {
        // const rdfLinks = this.rdfStore.each(el, this.prefs.RDF('type'), this.prefs.RDF('Property'));
        // const owlLinks = this.rdfStore.each(el, this.prefs.RDF('type'), this.prefs.OWL('ObjectProperty'));

        // return this.rdfStore.each(
        //     el,
        //     this.prefs.RDFS('label'),
        //     undefined,
        // ).map(l => ({
        //     text: l.value,
        //     lang: l.language,
        // }));
        return {};
    }

    private getTypes (el: $rdf.NamedNode): string[] {
        return this.rdfStore.each(
            el,
            this.prefs.RDF('type'),
            undefined,
        ).map(t => t.value);
    }

    private getCount (el: $rdf.NamedNode): number {
        return this.rdfStore.each(
            undefined,
            this.prefs.RDF('type'),
            el,
        ).length;
    }
}

export default RDFDataProvider;
