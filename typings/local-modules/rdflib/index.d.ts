declare module "rdflib" {
    function graph(): IndexedFormula;

    function parse(body: string, store: IndexedFormula, uri: string, mimeType: any): any;

    function Namespace(namespaces: string): () => NamedNode;

    function sym(id: string): NamedNode;

    class IndexedFormula extends Formula {
        HTTPRedirects: any[];
        aliases: any[];
        classActions: any[];
        constraints: any[];
        features: string[];
        index: any[][];
        initBindings: any[];
        namespaces: any;
        objectIndex: any[];
        optional: any[];
        predicateIndex: any[];
        propertyActions: any[];
        redirections: any[];
        statements: any[];
        subjectIndex: any[];
        termType: string;
        whyIndex: any[];
    }

    class Formula {
        add: (subj: any, pred: any, obj: any, why?: any) => void;
        addAll: (statements: any) => void;
        allAliases: (x: any) => void;
        any: (s: any, p: any, o: any, g?: any) => void;
        anyStatementMatching: (subj: any, pred: any, obj: any, why?: any) => any;
        anyValue: (s: any, p: any, o: any, g?: any) => any;
        each: (s: any, p: any, o: any, g?: any) => NamedNode[];
        statementsMatching: (s: any, p: any, o: any, g?: any) => Statement[];
    }

    class NamedNode {
        termType: string;
        value: string;
        language: string;
    }

    class Statement {
        object: NamedNode;
        predicate: NamedNode;
        subject: NamedNode;
        why: NamedNode;
    }
}
