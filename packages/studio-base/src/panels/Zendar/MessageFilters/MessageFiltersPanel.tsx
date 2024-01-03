// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import Log from "@foxglove/log";
import {
  MessageEvent,
  PanelExtensionContext,
  SettingsTreeAction,
  // SettingsTreeFields,
  SettingsTreeNode,
  SettingsTreeNodes,
  Topic,
} from "@foxglove/studio";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

const log = Log.getLogger(__filename);

type MessageFiltersPanelProps = {
  context: PanelExtensionContext;
};

type Filter = {
  field: string;
  type: "GT" | "GE" | "LT" | "LE" | "EQ" | "NE";
  value: number | string;
  func: (value: number | string) => boolean;
};

type Config = {
  topic: string | undefined;
  publish: string | undefined;
  filters: Filter[] | undefined;
};

const DEFAULT_CONFIG: Config = {
  topic: undefined,
  publish: undefined,
  filters: [],
};

function buildSettingsTree(config: Config, topics: readonly Topic[]): SettingsTreeNodes {
  const general: SettingsTreeNode = {
    label: "General",
    order: 0,
    fields: {
      topic: {
        label: "Topic",
        help: "Choose a topic to filter.",
        input: "select",
        options: topics
          .filter(({ schemaName }) => schemaName === "sensor_msgs/msg/PointCloud2")
          .map(({ name }) => ({ label: name, value: name })),
        value: config.topic,
      },
      publish: {
        label: "Publish As",
        help: "Set a name for the new topic.",
        input: "string",
        value: config.publish,
        placeholder: `${config.topic}/filtered`,
      },
    },
  };

  const filter: SettingsTreeNode = {
    label: "Filters",
    order: 1,
    fields: {
      field: {
        label: "Field",
        help: "Choose message field",
        input: "select",
        options: topics.map(({ schemaName }) => ({ label: schemaName, value: schemaName })),
      },
    },
  };

  return { general, filter };
}

function MessageFiltersPanel(props: MessageFiltersPanelProps): JSX.Element {
  const { context } = props;
  const { saveState } = context;

  const [config, setConfig] = useState<Config>(() => {
    return { ...DEFAULT_CONFIG, ...(context.initialState as Partial<Config>) };
  });

  const [topics, setTopics] = useState<readonly Topic[]>([]);
  const [currentFrame, setCurrentFrame] = useState<readonly MessageEvent[]>([]);
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("light");
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});

  useLayoutEffect(() => {
    context.watch("topics");
    context.watch("currentFrame");
    context.watch("colorScheme");

    context.onRender = (renderState, done) => {
      if (renderState.topics) {
        setTopics(renderState.topics);
      }

      if (renderState.currentFrame && renderState.currentFrame.length > 0) {
        setCurrentFrame(renderState.currentFrame);
      }

      if (renderState.colorScheme) {
        setColorScheme(renderState.colorScheme);
      }

      setRenderDone(() => done);
    };
  }, [context]);

  const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
    log.info(action);
    if (action.action === "update") {
      if (action.payload.path[0] === "general") {
        setConfig((previous) => {
          const newConfig = { ...previous };
          _.set(newConfig, action.payload.path.slice(1), action.payload.value);
          return newConfig;
        });
      }
    }
  }, []);

  useEffect(() => {
    const tree = buildSettingsTree(config, topics);
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: tree,
    });
    saveState(config);

    // context.subscribe();
  }, [config, topics, context, saveState, settingsActionHandler]);

  useEffect(() => {
    renderDone();
  }, [renderDone]);

  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <div>HI MOM</div>
    </ThemeProvider>
  );
}

export default MessageFiltersPanel;
