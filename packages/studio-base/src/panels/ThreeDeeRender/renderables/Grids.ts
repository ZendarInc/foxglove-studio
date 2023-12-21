// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";
import * as _ from "lodash-es";
import * as THREE from "three";

import Logger from "@foxglove/log";
import { SceneEntity } from "@foxglove/schemas";
import { TextPrimitive } from "@foxglove/schemas";
import { SettingsTreeAction, SettingsTreeFields } from "@foxglove/studio";
import { RenderableTexts } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/primitives/RenderableTexts";

import { RenderableLineList } from "./markers/RenderableLineList";
import type { IRenderer, RangeMarkersConfig } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { stringToRgba } from "../color";
import { vec3TupleApproxEquals } from "../math";
import { Marker, MarkerAction, MarkerType, TIME_ZERO, Vector3 } from "../ros";
import {
  CustomLayerSettings,
  LayerSettingsEntity,
  PRECISION_DEGREES,
  PRECISION_DISTANCE,
} from "../settings";
import { makePose, xyzrpyToPose } from "../transforms";

const log = Logger.getLogger(__filename);

export type LayerSettingsGrid = CustomLayerSettings & {
  layerId: "foxglove.Grid";
  frameId: string | undefined;
  gridSize: number;
  gridDivisions: number;
  gridLineWidth: number;
  gridColor: string;
  gridPosition: [number, number, number];
  gridRotation: [number, number, number];
  rangeMarkerVisible: boolean;
  rangeMarkerFollowCamera: boolean;
  rangeMarkerFollowCameraNudge: [number, number];
  rangeMarkerPosition: [number, number];
  rangeMarkerFontSize: number;
  rangeMarkerFontColor: string;
};

const LAYER_ID = "foxglove.Grid";
const DEFAULT_GRID_SIZE = 10;
const DEFAULT_GRID_DIVISIONS = 10;
const DEFAULT_GRID_LINE_WIDTH = 1;
const DEFAULT_GRID_COLOR = "#248eff";
const DEFAULT_RANGE_MARKER_VISIBLE = false;
const DEFAULT_RANGE_MARKER_FOLLOW_CAMERA = false;
const DEFAULT_RANGE_MARKER_FOLLOW_CAMERA_NUDGE: [number, number] = [0, 0];
const DEFAULT_RANGE_MARKER_POSITION: [number, number] = [-DEFAULT_GRID_SIZE, -DEFAULT_GRID_SIZE];
const DEFAULT_RANGE_MARKER_FONT_SIZE = 20;
const DEFAULT_RANGE_MARKER_FONT_COLOR = "#248eff";
const MAX_DIVISIONS = 4096; // The JS heap size is a limiting factor
const LINE_OPTIONS = { worldUnits: false };
const TEXTS_OPTIONS: LayerSettingsEntity = {
  visible: true,
  frameLocked: true,
  showOutlines: false,
  color: undefined,
  selectedIdVariable: undefined,
};

const DEFAULT_SETTINGS: LayerSettingsGrid = {
  visible: true,
  frameLocked: true,
  label: "Grid",
  instanceId: "invalid",
  layerId: LAYER_ID,
  frameId: undefined,

  gridSize: DEFAULT_GRID_SIZE,
  gridDivisions: DEFAULT_GRID_DIVISIONS,
  gridLineWidth: DEFAULT_GRID_LINE_WIDTH,
  gridColor: DEFAULT_GRID_COLOR,
  gridPosition: [0, 0, 0],
  gridRotation: [0, 0, 0],

  rangeMarkerVisible: DEFAULT_RANGE_MARKER_VISIBLE,
  rangeMarkerFollowCamera: DEFAULT_RANGE_MARKER_FOLLOW_CAMERA,
  rangeMarkerFollowCameraNudge: DEFAULT_RANGE_MARKER_FOLLOW_CAMERA_NUDGE,
  rangeMarkerPosition: DEFAULT_RANGE_MARKER_POSITION,
  rangeMarkerFontSize: DEFAULT_RANGE_MARKER_FONT_SIZE,
  rangeMarkerFontColor: DEFAULT_RANGE_MARKER_FONT_COLOR,
};

export type GridUserData = BaseUserData & {
  settings: LayerSettingsGrid;
  lineList: RenderableLineList;
  texts: RenderableTexts;
};

export class GridRenderable extends Renderable<GridUserData> {
  public override dispose(): void {
    this.userData.lineList.dispose();
    this.userData.texts.dispose();
    super.dispose();
  }
}

export class Grids extends SceneExtension<GridRenderable> {
  public static extensionId = "foxglove.Grids";
  public constructor(renderer: IRenderer, name: string = Grids.extensionId) {
    super(name, renderer);

    renderer.addCustomLayerAction({
      layerId: LAYER_ID,
      label: t("threeDee:addGrid"),
      icon: "Grid",
      handler: this.#handleAddGrid,
    });

    renderer.on("transformTreeUpdated", this.#handleTransformTreeUpdated);
    renderer.on("rangeMarkersConfigChanged", this.#handleRangeMarkersConfigChanged);
    renderer.on("cameraStateChanged", this.#handleCameraStateChanged);

    // Load existing grid layers from the config
    for (const [instanceId, entry] of Object.entries(renderer.config.layers)) {
      if (entry?.layerId === LAYER_ID) {
        this.#updateGrid(instanceId, entry as Partial<LayerSettingsGrid>);
      }
    }
  }

  public override dispose(): void {
    this.renderer.off("transformTreeUpdated", this.#handleTransformTreeUpdated);
    this.renderer.off("rangeMarkersConfigChanged", this.#handleRangeMarkersConfigChanged);
    this.renderer.off("cameraStateChanged", this.#handleCameraStateChanged);

    super.dispose();
  }

  public override removeAllRenderables(): void {
    // no-op
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const [instanceId, layerConfig] of Object.entries(this.renderer.config.layers)) {
      if (layerConfig?.layerId !== LAYER_ID) {
        continue;
      }

      const config = layerConfig as Partial<LayerSettingsGrid>;
      const frameIdOptions = [
        { label: "<Display frame>", value: undefined },
        ...this.renderer.coordinateFrameList,
      ];

      const fields: SettingsTreeFields = {
        frameId: {
          label: t("threeDee:frame"),
          input: "select",
          options: frameIdOptions,
          value: config.frameId,
        }, // options is extended in `settings.ts:buildTopicNode()`
        gridSize: {
          label: t("threeDee:size"),
          input: "number",
          min: 0,
          step: 0.5,
          precision: PRECISION_DISTANCE,
          value: config.gridSize,
          placeholder: String(DEFAULT_GRID_SIZE),
        },
        gridDivisions: {
          label: t("threeDee:divisions"),
          input: "number",
          min: 1,
          max: MAX_DIVISIONS,
          step: 1,
          precision: 0,
          value: config.gridDivisions,
          placeholder: String(DEFAULT_GRID_DIVISIONS),
        },
        gridLineWidth: {
          label: t("threeDee:lineWidth"),
          input: "number",
          min: 0,
          step: 0.5,
          precision: 1,
          value: config.gridLineWidth,
          placeholder: String(DEFAULT_GRID_LINE_WIDTH),
        },
        gridColor: {
          label: t("threeDee:color"),
          input: "rgba",
          value: config.gridColor,
          placeholder: DEFAULT_GRID_COLOR,
        },
        gridPosition: {
          label: t("threeDee:position"),
          input: "vec3",
          labels: ["X", "Y", "Z"],
          precision: PRECISION_DISTANCE,
          value: config.gridPosition ?? [0, 0, 0],
        },
        gridRotation: {
          label: t("threeDee:rotation"),
          input: "vec3",
          labels: ["R", "P", "Y"],
          precision: PRECISION_DEGREES,
          value: config.gridRotation ?? [0, 0, 0],
        },
        rangeMarkerVisible: {
          label: "Range Markers",
          input: "boolean",
          value: config.rangeMarkerVisible,
        },
        rangeMarkerFollowCamera: {
          disabled: true,
          label: "Follow Camera",
          input: "boolean",
          value: config.rangeMarkerFollowCamera,
        },
        rangeMarkerFollowCameraNudge: {
          disabled: !(config.rangeMarkerFollowCamera ?? DEFAULT_RANGE_MARKER_FOLLOW_CAMERA),
          label: "Nudge",
          input: "vec2",
          labels: ["X", "Y"],
          step:
            (0.25 * (config.gridSize ?? DEFAULT_GRID_SIZE)) /
            (config.gridDivisions ?? DEFAULT_GRID_DIVISIONS),
          precision: PRECISION_DISTANCE,
          value: config.rangeMarkerFollowCameraNudge,
        },
        rangeMarkerPosition: {
          disabled: config.rangeMarkerFollowCamera ?? DEFAULT_RANGE_MARKER_FOLLOW_CAMERA,
          label: "Position",
          input: "vec2",
          labels: ["X", "Y"],
          step:
            (0.25 * (config.gridSize ?? DEFAULT_GRID_SIZE)) /
            (config.gridDivisions ?? DEFAULT_GRID_DIVISIONS),
          precision: PRECISION_DISTANCE,
          value: config.rangeMarkerPosition,
        },
        rangeMarkerFontSize: {
          label: "Markers Font Size",
          input: "number",
          min: 0,
          step: 1,
          precision: 0,
          value: config.rangeMarkerFontSize,
          placeholder: String(DEFAULT_RANGE_MARKER_FONT_SIZE),
        },
        rangeMarkerFontColor: {
          label: "Markers Font Color",
          input: "rgba",
          value: config.rangeMarkerFontColor,
          placeholder: DEFAULT_RANGE_MARKER_FONT_COLOR,
        },
      };

      entries.push({
        path: ["layers", instanceId],
        node: {
          label: config.label ?? t("threeDee:grid"),
          icon: "Grid",
          fields,
          visible: config.visible ?? DEFAULT_SETTINGS.visible,
          actions: [{ type: "action", id: "delete", label: t("threeDee:delete") }],
          order: layerConfig.order,
          handler,
        },
      });

      // Create renderables for new grid layers
      if (!this.renderables.has(instanceId)) {
        this.#updateGrid(instanceId, config);
      }
    }
    return entries;
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    // Set the `frameId` to use for `updatePose()`
    for (const renderable of this.renderables.values()) {
      renderable.userData.frameId = renderable.userData.settings.frameId ?? renderFrameId;
    }
    super.startFrame(currentTime, renderFrameId, fixedFrameId);
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;

    // Handle menu actions (delete)
    if (action.action === "perform-node-action") {
      if (path.length === 2 && action.payload.id === "delete") {
        const instanceId = path[1]!;

        // Remove this instance from the config
        this.renderer.updateConfig((draft) => {
          delete draft.layers[instanceId];
        });

        // Remove the renderable
        this.#updateGrid(instanceId, undefined);

        // Update the settings tree
        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
      }
      return;
    }

    if (path.length !== 3) {
      return; // Doesn't match the pattern of ["layers", instanceId, field]
    }

    this.saveSetting(path, action.payload.value);

    const instanceId = path[1]!;
    const settings = this.renderer.config.layers[instanceId] as
      | Partial<LayerSettingsGrid>
      | undefined;
    this.#updateGrid(instanceId, settings);
  };

  #handleRangeMarkersConfigChanged = (rangeMarkersConfig: RangeMarkersConfig): void => {
    for (const [instanceId, entry] of Object.entries(this.renderer.config.layers)) {
      if (entry?.layerId !== LAYER_ID) {
        continue;
      }

      this.saveSetting(["layers", instanceId, "rangeMarkerVisible"], true);
      this.saveSetting(["layers", instanceId, "rangeMarkerFollowCameraNudge"], [0, 0]);
      this.saveSetting(
        ["layers", instanceId, "rangeMarkerFollowCamera"],
        rangeMarkersConfig.followCamera,
      );
      this.updateSettingsTree();

      const settings = this.renderer.config.layers[instanceId] as
        | Partial<LayerSettingsGrid>
        | undefined;
      this.#updateGrid(instanceId, settings);
    }
  };

  #handleCameraStateChanged = (): void => {
    for (const [instanceId, entry] of Object.entries(this.renderer.config.layers)) {
      if (entry?.layerId === LAYER_ID) {
        this.#updateGrid(instanceId, entry as Partial<LayerSettingsGrid>);
      }
    }
  };

  #handleAddGrid = (instanceId: string): void => {
    log.info(`Creating ${LAYER_ID} layer ${instanceId}`);

    const config: LayerSettingsGrid = { ...DEFAULT_SETTINGS, instanceId };

    // Add this instance to the config
    this.renderer.updateConfig((draft) => {
      const maxOrderLayer = _.maxBy(Object.values(draft.layers), (layer) => layer?.order);
      const order = 1 + (maxOrderLayer?.order ?? 0);
      draft.layers[instanceId] = { ...config, order };
    });

    // Add a renderable
    this.#updateGrid(instanceId, config);

    // Update the settings tree
    this.updateSettingsTree();
  };

  #handleTransformTreeUpdated = (): void => {
    this.updateSettingsTree();
  };

  #updateGrid(instanceId: string, settings: Partial<LayerSettingsGrid> | undefined): void {
    let renderable = this.renderables.get(instanceId);

    // Handle deletes
    if (settings == undefined) {
      if (renderable != undefined) {
        renderable.userData.lineList.dispose();
        renderable.userData.texts.dispose();

        this.remove(renderable);
        this.renderables.delete(instanceId);
      }
      return;
    }

    const newSettings = { ...DEFAULT_SETTINGS, ...settings };
    if (!renderable) {
      renderable = this.#createRenderable(instanceId, newSettings);
      renderable.userData.pose = xyzrpyToPose(newSettings.gridPosition, newSettings.gridRotation);
    }

    const prevSettings = renderable.userData.settings;
    renderable.userData.settings = newSettings;

    if (newSettings.rangeMarkerFollowCamera) {
      const newRangeMarkerPosition = this.#nudgeRangeMarkersIntoView(newSettings);
      newSettings.rangeMarkerPosition = newRangeMarkerPosition;
    }

    const lineList = createLineList(newSettings);
    renderable.userData.lineList.update(lineList, undefined);

    const texts = createTexts(newSettings);
    renderable.userData.texts.update(`${instanceId}:TEXTS`, texts, TEXTS_OPTIONS, 0n);

    // Update the pose if it changed
    if (
      !vec3TupleApproxEquals(newSettings.gridPosition, prevSettings.gridPosition) ||
      !vec3TupleApproxEquals(newSettings.gridRotation, prevSettings.gridRotation)
    ) {
      renderable.userData.pose = xyzrpyToPose(newSettings.gridPosition, newSettings.gridRotation);
    }
  }

  #nudgeRangeMarkersIntoView = (settings: LayerSettingsGrid): [number, number] => {
    const cameraState = this.renderer.getCameraState();
    if (!cameraState) {
      return settings.rangeMarkerPosition;
    }

    const tempVec2 = new THREE.Vector2();
    const renderSize = this.renderer.gl.getDrawingBufferSize(tempVec2);
    const aspectRatio = renderSize.width / renderSize.height;
    const FovAtGroundplane = Math.sin(cameraState.fovy / 2) * cameraState.distance;

    const followNudge = settings.rangeMarkerFollowCameraNudge;
    const viewportBounds: [number, number] = [
      FovAtGroundplane + cameraState.targetOffset[0] + followNudge[0],
      FovAtGroundplane * aspectRatio - cameraState.targetOffset[1] + followNudge[1],
    ];

    const gridNudge = (0.5 * settings.gridSize) / settings.gridDivisions;
    const gridBounds: [number, number] = [
      settings.gridPosition[0] - settings.gridSize / 2 - gridNudge,
      -settings.gridPosition[1] - settings.gridSize / 2 - gridNudge,
    ];

    const rangerMarkerBounds: [number, number] = [
      viewportBounds[0] > gridBounds[0] ? viewportBounds[0] : gridBounds[0],
      viewportBounds[1] > gridBounds[1] ? viewportBounds[1] : gridBounds[1],
    ];

    return rangerMarkerBounds;
  };

  #createRenderable(instanceId: string, settings: LayerSettingsGrid): GridRenderable {
    const lineList = createLineList(settings);
    const renderableLineList = new RenderableLineList(
      `${instanceId}:LINE_LIST`,
      lineList,
      undefined,
      this.renderer,
      LINE_OPTIONS,
    );

    const texts = createTexts(settings);
    const renderableTexts = new RenderableTexts(this.renderer);
    renderableTexts.update(`${instanceId}:TEXTS`, texts, TEXTS_OPTIONS, 0n);

    const renderable = new GridRenderable(instanceId, this.renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "", // This will be updated in `startFrame()`
      pose: makePose(),
      settingsPath: ["layers", instanceId],
      settings,
      lineList: renderableLineList,
      texts: renderableTexts,
    });

    renderable.add(renderableLineList);
    renderable.add(renderableTexts);

    this.add(renderable);
    this.renderables.set(instanceId, renderable);
    return renderable;
  }
}

function createLineList(settings: LayerSettingsGrid): Marker {
  const {
    gridSize: size,
    gridDivisions: divisions,
    gridColor: colorStr,
    gridLineWidth: lineWidth,
  } = settings;

  const step = size / divisions;
  const halfSize = size / 2;
  const points: Vector3[] = [];
  // Create a grid of line segments centered around <0, 0>
  for (let i = 0; i <= divisions; i++) {
    const x = -halfSize + i * step;
    points.push({ x, y: -halfSize, z: 0 });
    points.push({ x, y: halfSize, z: 0 });
    points.push({ x: -halfSize, y: x, z: 0 });
    points.push({ x: halfSize, y: x, z: 0 });
  }

  const color = { r: 1, g: 1, b: 1, a: 1 };
  stringToRgba(color, colorStr);

  return {
    header: {
      frame_id: "", // unused, settings.frameId is used instead
      stamp: TIME_ZERO,
    },
    ns: "",
    id: 0,
    type: MarkerType.LINE_LIST,
    action: MarkerAction.ADD,
    pose: makePose(),
    scale: { x: lineWidth, y: 1, z: 1 },
    color,
    lifetime: TIME_ZERO,
    frame_locked: true,
    points,
    colors: [],
    text: "",
    mesh_resource: "",
    mesh_use_embedded_materials: false,
  };
}

function createTexts(settings: LayerSettingsGrid): SceneEntity {
  const {
    rangeMarkerVisible: visible,
    rangeMarkerFontColor: colorStr,
    rangeMarkerFontSize: fontSize,
    rangeMarkerPosition: position,
    gridPosition,
    gridSize,
    gridDivisions,
  } = settings;

  const texts: TextPrimitive[] = [];
  if (visible) {
    const color = { r: 1, g: 1, b: 1, a: 1 };
    stringToRgba(color, colorStr);

    const step = gridSize / gridDivisions;
    const halfSize = gridSize / 2;

    for (let i = 0; i <= gridDivisions; i++) {
      const relDistance = -halfSize + i * step;
      const point: [number, number] = [
        relDistance + gridPosition[0],
        relDistance + gridPosition[1],
      ];

      texts.push({
        pose: {
          position: { x: relDistance, y: -position[1] - gridPosition[1], z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        billboard: true,
        font_size: fontSize,
        scale_invariant: true,
        color,
        text: String(point[0].toFixed(0)),
      });
      texts.push({
        pose: {
          position: { x: position[0] - gridPosition[0], y: relDistance, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        billboard: true,
        font_size: fontSize,
        scale_invariant: true,
        color,
        text: String(point[1].toFixed(0)),
      });
    }
  }

  return {
    timestamp: TIME_ZERO,
    frame_id: "",
    id: "RANGE_MARKERS",
    lifetime: TIME_ZERO,
    frame_locked: true,
    metadata: [],
    arrows: [],
    cubes: [],
    spheres: [],
    cylinders: [],
    lines: [],
    triangles: [],
    texts,
    models: [],
  };
}
