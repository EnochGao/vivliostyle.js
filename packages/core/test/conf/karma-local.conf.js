/**
 * Copyright 2017 Daishinsha Inc.
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
 */
/*eslint-env node */
/*eslint global-require: "off" */
module.exports = function (config) {
  var commonConfig = require("./karma-common.conf")(config);

  var options = {
    reporters: ["verbose"],
    autoWatch: true,
    captureTimeout: 120000,
  };
  for (var key in commonConfig) {
    if (commonConfig.hasOwnProperty(key)) {
      options[key] = commonConfig[key];
    }
  }

  config.set(options);
};
