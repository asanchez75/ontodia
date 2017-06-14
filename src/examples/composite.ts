import { createElement, ClassAttributes } from 'react';
import * as ReactDOM from 'react-dom';

import {
    Workspace,
    WorkspaceProps,
    RDFDataProvider,
    CompositeDataProvider,
    SparqlDataProvider,
    OWLStatsSettings,
    SparqlQueryMethod,
    DBPediaSettings,
 } from '../index';

import { onPageLoad, tryLoadLayoutFromLocalStorage, saveLayoutToLocalStorage } from './common';

const data = require<string>('raw-loader!./resources/testData.ttl');

require('jointjs/css/layout.css');
require('jointjs/css/themes/default.css');

function onWorkspaceMounted(workspace: Workspace) {
    if (!workspace) { return; }

    const model = workspace.getModel();
    model.graph.on('action:iriClick', (iri: string) => {
        window.open(iri);
    });

    const rdfDataProvider = new RDFDataProvider({
        data: [
            {
                content: data,
                type: 'text/turtle',
            },
        ],
    });

    const sparqlDataProvider = new SparqlDataProvider({
        endpointUrl: '/sparql-endpoint',
        imagePropertyUris: [
            'http://collection.britishmuseum.org/id/ontology/PX_has_main_representation',
            'http://xmlns.com/foaf/0.1/img',
        ],
        queryMethod: SparqlQueryMethod.GET,
    }, OWLStatsSettings);

    const dbPediaDataProvider = new SparqlDataProvider({
        endpointUrl: 'http://dbpedia.org/sparql',
        imagePropertyUris: [
            'http://xmlns.com/foaf/0.1/depiction',
            'http://xmlns.com/foaf/0.1/img',
        ],
        queryMethod: SparqlQueryMethod.GET,
    }, DBPediaSettings);

    const layoutData = tryLoadLayoutFromLocalStorage();
    model.importLayout({
        layoutData,
        validateLinks: true,
        dataProvider: new CompositeDataProvider([
            sparqlDataProvider,
            rdfDataProvider,
            dbPediaDataProvider,
        ]),
    });
}

const props: WorkspaceProps & ClassAttributes<Workspace> = {
    ref: onWorkspaceMounted,
    onSaveDiagram: workspace => {
        const {layoutData} = workspace.getModel().exportLayout();
        window.location.hash = saveLayoutToLocalStorage(layoutData);
        window.location.reload();
    },
};

onPageLoad(container => ReactDOM.render(createElement(Workspace, props), container));
