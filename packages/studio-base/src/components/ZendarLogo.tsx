// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SvgIcon, SvgIconProps } from "@mui/material";

export function ZendarLogo(props: SvgIconProps): JSX.Element {
  return (
    <SvgIcon viewBox="0 0 304 211" {...props}>
      <title>Zendar</title>
      <svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="304px" height="211px">
        <g>
          <path
            fill="#00ba5e"
            d="M 72.5,-0.5 C 125.5,-0.5 178.5,-0.5 231.5,-0.5C 231.666,7.1739 231.5,14.8406 231,22.5C 195.5,73.3333 160,124.167 124.5,175C 159.832,175.5 195.165,175.667 230.5,175.5C 230.5,187.167 230.5,198.833 230.5,210.5C 177.5,210.5 124.5,210.5 71.5,210.5C 71.0619,202.057 71.5619,193.723 73,185.5C 107.639,135.362 142.472,85.362 177.5,35.5C 142.506,34.5001 107.506,34.1668 72.5,34.5C 72.5,22.8333 72.5,11.1667 72.5,-0.5 Z"
          />
        </g>
        <g>
          <path
            fill="#00ba5e"
            d="M 10.5,2.5 C 26.7561,1.34455 32.9227,8.67789 29,24.5C 22.7451,31.9135 15.2451,33.4135 6.5,29C 0.0641625,22.4411 -0.769171,15.2744 4,7.5C 5.96514,5.44965 8.13181,3.78299 10.5,2.5 Z"
          />
        </g>
        <g>
          <path
            fill="#00ba5e"
            d="M 282.5,178.5 C 297.262,177.424 303.429,184.09 301,198.5C 296.936,206.61 290.436,209.443 281.5,207C 272.878,202.14 270.378,194.974 274,185.5C 276.464,182.519 279.297,180.186 282.5,178.5 Z"
          />
        </g>
      </svg>
    </SvgIcon>
  );
}
