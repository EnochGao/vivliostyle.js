/**
 * Copyright 2016 Trim-marks Inc.
 *
 * Vivliostyle.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Vivliostyle.js is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Vivliostyle.js.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @fileoverview Utilities related to layout.
 */
import * as layoutImpl from '../adapt/layout';
import * as task from '../adapt/task';
import * as vtreeImpl from '../adapt/vtree';
import * as breaks from './break';
import * as breakposition from './breakposition';
import {layout, vtree} from './types';

type LayoutIteratorState = {
  nodeContext: vtree.NodeContext,
  atUnforcedBreak: boolean,
  break: boolean,
  leadingEdge?: boolean,
  breakAtTheEdge?: string|null,
  onStartEdges?: boolean,
  leadingEdgeContexts?: vtree.NodeContext[],
  lastAfterNodeContext?: vtree.NodeContext|null
};

export {LayoutIteratorState};

export class LayoutIteratorStrategy {
  initialState(initialNodeContext: vtree.NodeContext): LayoutIteratorState {
    return {
      nodeContext: initialNodeContext,
      atUnforcedBreak: false,
      break: false
    };
  }

  startNonDisplayableNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  afterNonDisplayableNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  startIgnoredTextNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  afterIgnoredTextNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  startNonElementNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  afterNonElementNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  startInlineElementNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  afterInlineElementNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  startNonInlineElementNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  afterNonInlineElementNode(state: LayoutIteratorState): void | task.Result<boolean> {}

  finish(state: LayoutIteratorState): void | task.Result<boolean> {}
}

export class LayoutIterator {
  constructor(
      private readonly strategy: LayoutIteratorStrategy,
      private readonly layoutContext: vtree.LayoutContext) {}

  iterate(initialNodeContext: vtree.NodeContext):
      task.Result<vtree.NodeContext> {
    const strategy = this.strategy;
    const state = strategy.initialState(initialNodeContext);
    const frame: task.Frame<vtree.NodeContext> =
        task.newFrame('LayoutIterator');
    frame
        .loopWithFrame((loopFrame) => {
          let r;
          while (state.nodeContext) {
            if (!state.nodeContext.viewNode) {
              if (state.nodeContext.after) {
                r = strategy.afterNonDisplayableNode(state);
              } else {
                r = strategy.startNonDisplayableNode(state);
              }
            } else if (state.nodeContext.viewNode.nodeType !== 1) {
              if (vtreeImpl.canIgnore(
                      state.nodeContext.viewNode,
                      state.nodeContext.whitespace)) {
                if (state.nodeContext.after) {
                  r = strategy.afterIgnoredTextNode(state);
                } else {
                  r = strategy.startIgnoredTextNode(state);
                }
              } else {
                if (state.nodeContext.after) {
                  r = strategy.afterNonElementNode(state);
                } else {
                  r = strategy.startNonElementNode(state);
                }
              }
            } else {
              if (state.nodeContext.inline) {
                if (state.nodeContext.after) {
                  r = strategy.afterInlineElementNode(state);
                } else {
                  r = strategy.startInlineElementNode(state);
                }
              } else {
                if (state.nodeContext.after) {
                  r = strategy.afterNonInlineElementNode(state);
                } else {
                  r = strategy.startNonInlineElementNode(state);
                }
              }
            }
            const cont = r && r.isPending() ? r : task.newResult(true);
            const nextResult = cont.thenAsync(() => {
              if (state.break) {
                return task.newResult(null);
              }
              return this.layoutContext.nextInTree(
                  state.nodeContext, state.atUnforcedBreak);
            });
            if (nextResult.isPending()) {
              nextResult.then((nextNodeContext) => {
                if (state.break) {
                  loopFrame.breakLoop();
                } else {
                  state.nodeContext = nextNodeContext;
                  loopFrame.continueLoop();
                }
              });
              return;
            } else if (state.break) {
              loopFrame.breakLoop();
              return;
            } else {
              state.nodeContext = nextResult.get();
            }
          }
          strategy.finish(state);
          loopFrame.breakLoop();
        })
        .then(() => {
          frame.finish(state.nodeContext);
        });
    return frame.result();
  }
}

export class EdgeSkipper extends LayoutIteratorStrategy {
  constructor(protected readonly leadingEdge?: boolean) {
      super()
  }

  startNonInlineBox(state: LayoutIteratorState): void | task.Result<boolean> {}

  endEmptyNonInlineBox(state: LayoutIteratorState): void | task.Result<boolean> {}

  endNonInlineBox(state: LayoutIteratorState): void | task.Result<boolean> {}

  initialState(initialNodeContext: vtree.NodeContext): LayoutIteratorState {
    return {
      nodeContext: initialNodeContext,
      atUnforcedBreak: !!this.leadingEdge && initialNodeContext.after,
      break: false,
      leadingEdge: this.leadingEdge,
      breakAtTheEdge: null,
      onStartEdges: false,
      leadingEdgeContexts: [],
      lastAfterNodeContext: null
    };
  }

  /**
   * @return Returns true if a forced break occurs.
   */
  processForcedBreak(state: LayoutIteratorState, column: layout.Column): boolean {
    const needForcedBreak =
        !state.leadingEdge && breaks.isForcedBreakValue(state.breakAtTheEdge);
    if (needForcedBreak) {
      const nodeContext = state.nodeContext =
          state.leadingEdgeContexts[0] || state.nodeContext;
      nodeContext.viewNode.parentNode.removeChild(nodeContext.viewNode);
      column.pageBreakType = state.breakAtTheEdge;
    }
    return needForcedBreak;
  }

  /**
   * @return Returns true if the node overflows the column.
   */
  saveEdgeAndProcessOverflow(state: LayoutIteratorState, column: layout.Column):
      boolean {
    const overflow = column.checkOverflowAndSaveEdgeAndBreakPosition(
        state.lastAfterNodeContext, null, true, state.breakAtTheEdge);
    if (overflow) {
      state.nodeContext =
          (state.lastAfterNodeContext || state.nodeContext).modify();
      state.nodeContext.overflow = true;
    }
    return overflow;
  }

  /**
   * @returns Returns true if the layout constraint is violated.
   */
  processLayoutConstraint(
      state: LayoutIteratorState, layoutConstraint: layout.LayoutConstraint,
      column: layout.Column): boolean {
    let nodeContext = state.nodeContext;
    const violateConstraint = !layoutConstraint.allowLayout(nodeContext);
    if (violateConstraint) {
      column.checkOverflowAndSaveEdgeAndBreakPosition(
          state.lastAfterNodeContext, null, false, state.breakAtTheEdge);
      nodeContext = state.nodeContext = nodeContext.modify();
      nodeContext.overflow = true;
    }
    return violateConstraint;
  }

  /**
   * @override
   */
  startNonElementNode(state) {
    state.onStartEdges = false;
  }

  /**
   * @override
   */
  startNonInlineElementNode(state) {
    state.leadingEdgeContexts.push(state.nodeContext.copy());
    state.breakAtTheEdge = breaks.resolveEffectiveBreakValue(
        state.breakAtTheEdge, state.nodeContext.breakBefore);
    state.onStartEdges = true;
    return this.startNonInlineBox(state);
  }

  /**
   * @override
   */
  afterNonInlineElementNode(state) {
    let r;
    let cont;
    if (state.onStartEdges) {
      r = this.endEmptyNonInlineBox(state);
      cont = r && r.isPending() ? r : task.newResult(true);
      cont = cont.thenAsync(() => {
        if (!state.break) {
          state.leadingEdgeContexts = [];
          state.leadingEdge = false;
          state.atUnforcedBreak = false;
          state.breakAtTheEdge = null;
        }
        return task.newResult(true);
      });
    } else {
      r = this.endNonInlineBox(state);
      cont = r && r.isPending() ? r : task.newResult(true);
    }
    return cont.thenAsync(() => {
      if (!state.break) {
        state.onStartEdges = false;
        state.lastAfterNodeContext = state.nodeContext.copy();
        state.breakAtTheEdge = breaks.resolveEffectiveBreakValue(
            state.breakAtTheEdge, state.nodeContext.breakAfter);
      }
      return task.newResult(true);
    });
  }
}

/**
 * Represents a "pseudo"-column nested inside a real column.
 * This class is created to handle parallel fragmented flows (e.g. table columns
 * in a single table row). A pseudo-column behaves in the same way as the
 * original column, sharing its properties. Property changes on the
 * pseudo-column are not propagated to the original column. The LayoutContext of
 * the original column is also cloned and used by the pseudo-column, not to
 * propagate state changes of the LayoutContext caused by the pseudo-column.
 * @param column The original (parent) column
 * @param viewRoot Root element for the pseudo-column, i.e., the root of the
 *     fragmented flow.
 * @param parentNodeContext A NodeContext generating this PseudoColumn
 */
export class PseudoColumn {
  startNodeContexts: vtree.NodeContext[] = [];
  private column: any;

  constructor(
      column: layout.Column, viewRoot: Element, parentNodeContext: vtree.NodeContext) {
    this.column = (Object.create(column) as layout.Column);
    this.column.element = viewRoot;
    this.column.layoutContext = column.layoutContext.clone();
    this.column.stopAtOverflow = false;
    this.column.flowRootFormattingContext = parentNodeContext.formattingContext;
    this.column.pseudoParent = column;
    const parentClonedPaddingBorder =
        this.column.calculateClonedPaddingBorder(parentNodeContext);
    this.column.footnoteEdge =
        this.column.footnoteEdge - parentClonedPaddingBorder;
    const pseudoColumn = this;
    this.column.openAllViews = function(position) {
      return layoutImpl.Column.prototype.openAllViews.call(this, position)
          .thenAsync((result) => {
            pseudoColumn.startNodeContexts.push(result.copy());
            return task.newResult(result);
          });
    };
  }

  /**
   * @param chunkPosition starting position.
   * @return holding end position.
   */
  layout(chunkPosition: vtree.ChunkPosition, leadingEdge: boolean):
      task.Result<vtree.ChunkPosition> {
    return this.column.layout(chunkPosition, leadingEdge);
  }

  findAcceptableBreakPosition(allowBreakAtStartPosition: boolean):
      layout.BreakPositionAndNodeContext {
    const p = this.column.findAcceptableBreakPosition();
    if (allowBreakAtStartPosition) {
      const startNodeContext = this.startNodeContexts[0].copy();
      const bp = new breakposition.EdgeBreakPosition(
          startNodeContext, null, startNodeContext.overflow, 0);
      bp.findAcceptableBreak(this.column, 0);
      if (!p.nodeContext) {
        return {breakPosition: bp, nodeContext: startNodeContext};
      }
    }
    return p;
  }

  /**
   * @return holing true
   */
  finishBreak(
      nodeContext: vtree.NodeContext, forceRemoveSelf: boolean,
      endOfColumn: boolean): task.Result<boolean> {
    return this.column.finishBreak(nodeContext, forceRemoveSelf, endOfColumn);
  }

  doFinishBreakOfFragmentLayoutConstraints(positionAfter: vtree.NodeContext) {
    this.column.doFinishBreakOfFragmentLayoutConstraints(positionAfter);
  }

  isStartNodeContext(nodeContext: vtree.NodeContext): boolean {
    const startNodeContext = this.startNodeContexts[0];
    return startNodeContext.viewNode === nodeContext.viewNode &&
        startNodeContext.after === nodeContext.after &&
        startNodeContext.offsetInNode === nodeContext.offsetInNode;
  }

  isLastAfterNodeContext(nodeContext: vtree.NodeContext): boolean {
    return vtreeImpl.isSameNodePosition(
        nodeContext.toNodePosition(), this.column.lastAfterPosition);
  }

  getColumnElement(): Element {
    return this.column.element;
  }

  getColumn(): layout.Column {
    return this.column;
  }
}
