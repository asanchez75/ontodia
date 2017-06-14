import { DataProvider, FilterParams } from '../provider';
import {
    Dictionary,
    ClassModel,
    LinkType,
    ElementModel,
    LinkModel,
    LinkCount,
    Property,
    PropertyModel,
    LocalizedString,
} from '../model';

export class CompositeDataProvider implements DataProvider {
    constructor(
        public dataProviders: DataProvider[],
    ) { }

    classTree(): Promise<ClassModel[]> {
        const resultPromises = this.dataProviders.map(dp => dp.classTree());
        return Promise.all(resultPromises).then(this.mergeClassTree);
    }

    propertyInfo(params: { propertyIds: string[] }): Promise<Dictionary<PropertyModel>> {
        const resultPromises = this.dataProviders.map(dp => dp.propertyInfo(params));
        return Promise.all(resultPromises).then(this.mergePropertyInfo);
    }

    classInfo(params: { classIds: string[] }): Promise<ClassModel[]> {
        const resultPromises = this.dataProviders.map(dp => dp.classInfo(params));
        return Promise.all(resultPromises).then(this.mergeClassInfo);
    }

    linkTypesInfo(params: {linkTypeIds: string[]}): Promise<LinkType[]> {
        const resultPromises = this.dataProviders.map(dp => dp.linkTypesInfo(params));
        return Promise.all(resultPromises).then(this.mergeLinkTypesInfo);
    }

    linkTypes(): Promise<LinkType[]> {
        const resultPromises = this.dataProviders.map(dp => dp.linkTypes());
        return Promise.all(resultPromises).then(this.mergeLinkTypes);
    }

    elementInfo(params: { elementIds: string[]; }): Promise<Dictionary<ElementModel>> {
        const resultPromises = this.dataProviders.map(dp => dp.elementInfo(params));
        return Promise.all(resultPromises).then(this.mergeElementInfo);
    }

    linksInfo(params: {
        elementIds: string[];
        linkTypeIds: string[];
    }): Promise<LinkModel[]> {
        const resultPromises = this.dataProviders.map(dp => dp.linksInfo(params));
        return Promise.all(resultPromises).then(this.mergeLinksInfo);
    }

    linkTypesOf(params: { elementId: string; }): Promise<LinkCount[]> {
        const resultPromises = this.dataProviders.map(dp => dp.linkTypesOf(params));
        return Promise.all(resultPromises).then(this.mergeLinkTypesOf);
    };

    linkElements(params: {
        elementId: string;
        linkId: string;
        limit: number;
        offset: number;
        direction?: 'in' | 'out';
    }): Promise<Dictionary<ElementModel>> {
        const resultPromises = this.dataProviders.map(dp => dp.linkElements(params));
        return Promise.all(resultPromises).then(this.mergeLinkElements);
    }

    filter(params: FilterParams): Promise<Dictionary<ElementModel>> {
        const resultPromises = this.dataProviders.map(dp => dp.filter(params));
        return Promise.all(resultPromises).then(this.mergeFilter);
    };

    private mergeClassTree = (trees: ClassModel[][]): ClassModel[] => {
        const lists = trees.map(t => this.classTree2Array(t));
        const dictionary: Dictionary<ClassModel> = {};
        const topLevelModels: Dictionary<ClassModel> = {};
        const childrenMap: Dictionary<string[]> = {};

        const self = this;

        for (const list of lists) {
            for (const model of list) {
                const childrenIds: string[] = childrenMap[model.id] || [];
                model.children.map(ch => ch.id).forEach(id => {
                    if (childrenIds.indexOf(id) === -1) {
                        childrenIds.push(id);
                    }
                });
                model.children = [];
                model.count = undefined;

                if (!dictionary[model.id]) {
                    topLevelModels[model.id] = model;
                    dictionary[model.id] = model;
                    childrenMap[model.id] = childrenIds;
                } else {
                    topLevelModels[model.id] = this.mergeClassModel(dictionary[model.id], model);
                    dictionary[model.id] = topLevelModels[model.id];
                }
            }
        }

        const models = Object.keys(dictionary).map(key => dictionary[key]);

        for (const m of models) {
            m.children = (childrenMap[m.id] || []).map(id => {
                delete topLevelModels[id];
                return dictionary[id];
            });
        }

        return Object.keys(topLevelModels).map(key => topLevelModels[key]);
    }

    private mergePropertyInfo = (models: Dictionary<PropertyModel>[]): Dictionary<PropertyModel> => {
        const result: Dictionary<PropertyModel> = {};
        for (const model of models) {
            const keys = Object.keys(model);
            for (const key of keys) {
                const prop = model[key];
                if (!result[key]) {
                    result[key] = prop;
                } else {
                    result[key].label = this.mergeLabels(result[key].label, prop.label);
                }
            }
        }
        return result;
    }

    private mergeClassInfo(classInfoResults: ClassModel[][]): ClassModel[] {
        const dictionary: Dictionary<ClassModel> = {};
        for (const models of classInfoResults) {
            for (const model of models) {
                if (!dictionary[model.id]) {
                    dictionary[model.id] = model;
                } else {
                    dictionary[model.id] = this.mergeClassModel(dictionary[model.id], model);
                }
            }
        }
        return Object.keys(dictionary).map(key => dictionary[key]);
    }

    private mergeLinkTypesInfo = (typesInfoResults: LinkType[][]): LinkType[] => {
        const mergeLinkType = (a: LinkType, b: LinkType): LinkType => {
            return {
                id: a.id,
                label: this.mergeLabels(a.label, b.label),
                count: Math.max(a.count, b.count),
            };
        };

        const dictionary: Dictionary<LinkType> = {};

        for (const linkTypes of typesInfoResults) {
            for (const linkType of linkTypes) {
                if (!dictionary[linkType.id]) {
                    dictionary[linkType.id] = linkType;
                } else {
                    dictionary[linkType.id] = mergeLinkType(dictionary[linkType.id], linkType);
                }
            }
        }
        return Object.keys(dictionary).map(key => dictionary[key]);
    }

    private mergeLinkTypes = (models: LinkType[][]): LinkType[] => {
        return this.mergeLinkTypesInfo(models);
    }

    private mergeElementInfo = (models: Dictionary<ElementModel>[]): Dictionary<ElementModel> => {
        const lists = models.map(dict => Object.keys(dict).map(k => dict[k]));
        const dictionary: Dictionary<ElementModel> = {};

        const mergeElementModels = (a: ElementModel, b: ElementModel): ElementModel => {
            const types = a.types;
            for (const t of b.types) {
                if (types.indexOf(t) === -1) {
                    types.push(t);
                }
            }
            return {
                id: a.id,
                label: this.mergeLabels(a.label, b.label),
                types: types,
                image: a.image || b.image,
                properties: this.mergeProperty(a.properties, b.properties),
            };
        };

        for (const linst of lists) {
            for (const em of linst) {
                if (!dictionary[em.id]) {
                    dictionary[em.id] = em;
                } else {
                    dictionary[em.id] = mergeElementModels(dictionary[em.id], em);
                }
            }
        }

        return dictionary;
    }

    private mergeProperty = (a: Dictionary<Property>, b: Dictionary<Property>): Dictionary<Property> => {
        const aLists = Object.keys(a);
        const bLists = Object.keys(b);

        const result: Dictionary<Property> = {};

        for (const pKey of aLists) {
            const prop = a[pKey];
            if (!result[pKey]) {
                result[pKey] = prop;
            } else {
                result[pKey].values = this.mergeLabels(result[pKey], prop).values;
            }
        }

        return result;
    }

    private mergeLinksInfo(linkInfoResponse: LinkModel[][]): LinkModel[] {
        const resultInfo: LinkModel[] = [];

        function compareLinksInfo (a: LinkModel, b: LinkModel): boolean {
            return a.sourceId === b.sourceId &&
                   a.targetId === b.targetId &&
                   a.linkTypeId === b.linkTypeId;
        }

        for (const linkInfo of linkInfoResponse) {
            for (const linkModel of linkInfo) {
                if (!contain<LinkModel>(linkModel, resultInfo, compareLinksInfo)) {
                    resultInfo.push(linkModel);
                }
            }
        }
        return resultInfo;
    }

    private mergeLinkTypesOf(linkKountsResponse: LinkCount[][]): LinkCount[] {
        const dictionary: Dictionary<LinkCount> = {};

        const mergeCounts = (a: LinkCount, b: LinkCount): LinkCount => {
            return {
                id: a.id,
                inCount: Math.max(a.inCount, b.inCount),
                outCount: Math.max(a.outCount, b.outCount),
            };
        };

        for (const linkCount of linkKountsResponse) {
            for (const lCount of linkCount) {
                if (!dictionary[lCount.id]) {
                    dictionary[lCount.id] = lCount;
                } else {
                    dictionary[lCount.id] = mergeCounts(lCount, dictionary[lCount.id]);
                }
            }
        }
        return Object.keys(dictionary).map(key => dictionary[key]);
    }

    private mergeLinkElements = (models: Dictionary<ElementModel>[]): Dictionary<ElementModel> => {
        return this.mergeElementInfo(models);
    }

    private mergeFilter = (models: Dictionary<ElementModel>[]): Dictionary<ElementModel> => {
        return this.mergeElementInfo(models);
    }

    private classTree2Array(models: ClassModel[]): ClassModel[] {
        let resultArray: ClassModel[] = models;

        function getDescendants(model: ClassModel): ClassModel[] {
            let descendants = model.children || [];
            for (const descendant of descendants) {
                const nextGeneration = getDescendants(descendant);
                descendants = descendants.concat(nextGeneration);
            }
            return descendants;
        }

        for (const model of models) {
            const descendants = getDescendants(model);
            resultArray = resultArray.concat(descendants);
        }

        return resultArray;
    }

    private mergeLabels(
        a: { values: LocalizedString[] },
        b: { values: LocalizedString[] },
    ): { values: LocalizedString[] } {

        function compareLabels (l1: LocalizedString, l2: LocalizedString): boolean {
            return l1.lang === l2.lang && l1.text === l2.text;
        }

        const mergedValuesList = a.values;

        for (const locStr of b.values) {
            if (!contain<LocalizedString>(locStr, mergedValuesList, compareLabels)) {
                mergedValuesList.push(locStr);
            }
        }

        return {
            values: mergedValuesList,
        };
    }

    private mergeClassModel = (a: ClassModel, b: ClassModel): ClassModel => {
        const childrenDictionary: Dictionary<ClassModel> = {};
        for (const child of a.children.concat(b.children)) {
            if (!childrenDictionary[child.id]) {
                childrenDictionary[child.id] = child;
            }
        }

        return {
            id: a.id,
            label: this.mergeLabels(a.label, b.label),
            count: Math.max(a.count, b.count),
            children: Object.keys(childrenDictionary).map(key => childrenDictionary[key]),
        };
    }
}

export default CompositeDataProvider;

function contain<Type>(locStr: Type, strList: Type[], comparator: (a: Type, b: Type) => boolean) {
    for (const ls of strList) {
        if (comparator(ls, locStr)) {
            return true;
        }
    }
    return false;
}
