import * as joint from 'jointjs';
import { LinkRouter, Vertex } from '../customization/props';
import { DiagramModel } from './model';
import { Link, Element } from './elements';
import { LinkView } from './linkView';

const GAP = 20;

export function getDefaultLinkRouter(diagramModel: DiagramModel): LinkRouter {
    return (vertices: Vertex[], args: {}, linkView: LinkView): Vertex[] => {
        const currentLink = linkView.model;
        if (!vertices) {
            vertices = [];
        }
        // If the cell is a view, find its model.

        // The cell is a link. Let's find its source and target models.
        let sourceId = currentLink.get('source').id || currentLink.previous('source').id;
        let targetId = currentLink.get('target').id || currentLink.previous('target').id;

        if (sourceId === targetId) {
            const element = diagramModel.getElement(sourceId);
            const siblings = element.links.filter(link => {
                const verts = link.get('vertices');
                return link.get('source').id === link.get('target').id && (!verts || verts.length === 0);
            });
            const currentLinkIndex = siblings.indexOf(currentLink);

            if (currentLinkIndex !== -1) {
                vertices = updateFeedbackSibling(currentLink, element, currentLinkIndex, true);
            }

            siblings.forEach((link, index) => {
                if (link !== currentLink) {
                    updateFeedbackSibling(link, element, index);
                }
            });
        }

        // Use the same direction for all siblings.
        // We don't know whether the link goes from
        // node A to node B or from B to A
        // and to have it right directioned we define direction.
        // In other words all links will have same direction because of the fact that
        // all links will have the same couple of ids
        const direction = sourceId > targetId;
        if (direction) {
            const temp = sourceId;
            sourceId = targetId;
            targetId = temp;
        }

        // If one of the ends is not a model, the link has no siblings.
        if (!sourceId || !targetId) {
            return vertices;
        }

        const links: Link[] = getLinksBetweenElements(diagramModel, sourceId, targetId);
        if (links.length < 2) {
            return vertices;
        }

        const siblings: Link[] = links.filter((link) => {
            const verts = link.get('vertices');
            if (verts && verts.length !== 0) {
                return false;
            }
            const _sourceId = link.get('source').id;
            const _targetId = link.get('target').id;

            return _sourceId !== _targetId && (
                  (_sourceId === sourceId && _targetId === targetId) ||
                  (_sourceId === targetId && _targetId === sourceId)
            );
        });

        // There is more than one siblings. We need to create vertices.
        // First of all we'll find the middle point of the link.
        const srcCenter = diagramModel.graph.getCell(sourceId).getBBox().center();
        const trgCenter = diagramModel.graph.getCell(targetId).getBBox().center();
        const midPoint = joint.g.line(srcCenter, trgCenter).midpoint();

        // Then find the angle it forms.
        const theta = srcCenter.theta(trgCenter);

        const currentLinkIndex = siblings.indexOf(currentLink);
        if (currentLinkIndex !== -1) {
            const v = getVertexForLink(
                theta,
                midPoint,
                siblings.length,
                currentLinkIndex,
                diagramModel,
            );
            updateLinkLabel(
                currentLink,
                currentLinkIndex,
                theta,
                siblings.length,
                direction,
            );
            currentLink.updateRouting(v, {silent: true});
            vertices = [v];
        } else {
            currentLink.label(0, {
                position: 0.5,
                attrs: {
                    rect: {'x-alignment': 'middle'},
                    text: {'text-anchor': 'middle'},
                },
            });
        }

        siblings.forEach((sib, index) => {
            if (sib !== currentLink) {
                const vertex = getVertexForLink(
                    theta,
                    midPoint,
                    siblings.length,
                    index,
                    diagramModel,
                );
                sib.updateRouting(vertex);
            }
        });

        return vertices;
    };
}

function getVertexForLink(
    theta: number,
    midPoint: joint.g.point,
    length: number,
    currentIndex: number,
    diagramModel: DiagramModel,
): Vertex {

    // For mor beautifull positioning
    const indexModifyer = length % 2 ? 0 : 1;
    const index = currentIndex + indexModifyer;

    // We want the offset values to be calculated as follows 0, 50, 50, 100, 100, 150, 150 ..
    const offset = GAP * Math.ceil(index / 2) - (indexModifyer ? GAP / 2 : 0);
    // Now we need the vertices to be placed at points which are 'offset' pixels distant
    // from the first link and forms a perpendicular angle to it. And as index goes up
    // alternate left and right.
    //
    //  ^  odd indexes
    //  |
    //  |---->  index 0 line (straight line between a source center and a target center.
    //  |
    //  v  even indexes
    const sign = index % 2 ? 1 : -1;
    const angle = joint.g.toRad(theta + sign * 90);

    // We found the vertex.
    const vertex = joint.g.point.fromPolar(offset, angle, midPoint);

    return vertex;
}

function updateLinkLabel(link: Link, index: number, theta: number, length: number, direction: boolean) {
    const indexModifyer = length % 2 ? 0 : 1;
    const sign = (index + indexModifyer) % 2 ? 1 : -1;
    const angle = joint.g.toRad(theta + sign);

    // calculate label position and save vertices
    let angleCoeff = 1 - Math.abs(Math.cos(angle));
    if (
        (angle > 0) && (angle < Math.PI / 2) ||
        (angle > Math.PI) && (angle < Math.PI * 3 / 2)
    ) {
        angleCoeff *= -1;
    }
    const labeloffset = (sign / (length * 3)) * index * angleCoeff;
    const labelPos = 0.5 + (direction ? labeloffset : -labeloffset);

    link.label(0, {
        position: labelPos,
        attrs: getAlignment(index, length, angle),
    });
}

function updateFeedbackSibling(link: Link, element: Element, index: number, silent?: boolean): Vertex[] {
    const elementSize = element.get('size');
    const elementPosition = element.position();
    const offset = index + 1;
    const resultVertices = [
        {x: elementPosition.x - GAP * offset, y: elementPosition.y + elementSize.height / 2},
        {x: elementPosition.x - GAP * offset, y: elementPosition.y - GAP * offset},
        {x: elementPosition.x  + elementSize.width / 2, y: elementPosition.y - GAP * offset},
    ];
    link.updateRouting(resultVertices[0], {silent: silent});
    return resultVertices;
}

function getLinksBetweenElements(model: DiagramModel, eID1: string, eID2: string): Link[] {
    const linksOfSource = model.getElement(eID1).links;
    const linksOfTarget = model.getElement(eID2).links;

    return linksOfSource.filter(l => {
        return linksOfTarget.indexOf(l) !== -1;
    });
}

function getAlignment(index: number, length: number, angle: number): {
    rect: {'x-alignment': string},
    text: {'text-anchor': string},
} {
    const inTopSector = (angle > Math.PI * 1 / 8) && (angle < Math.PI * 7 / 8);
    const inBottomSector = (angle > Math.PI * 9 / 8) && (angle < Math.PI * 15 / 8);
    const setOffset = length > 1 && (inTopSector || inBottomSector);

    const MIDDLE_LABEL_POSITION = {
        rect: {'x-alignment': 'middle'},
        text: {'text-anchor': 'middle'},
    };

    if (setOffset) {
        if (inTopSector && index === (length - 2) || inBottomSector && index === (length - 1)) {
            return {
                rect: {'x-alignment': 'left'},
                text: {'text-anchor': 'end'},
            };
        } else if (inTopSector && index === (length - 1) || inBottomSector && index === (length - 2)) {
            return {
                rect: {'x-alignment': 'right'},
                text: {'text-anchor': 'left'},
            };
        } else {
            return MIDDLE_LABEL_POSITION;
        }
    } else {
        return MIDDLE_LABEL_POSITION;
    }
}

export default getDefaultLinkRouter;
