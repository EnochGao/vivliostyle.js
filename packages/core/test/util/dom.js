/**
 * Copyright 2015 Daishinsha Inc.
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
// goog.provide("vivliostyle.test.util.dom");

// (function() {
//     var domUtil = vivliostyle.test.util.dom;

var dummyElements = [];

afterEach(function () {
  var e;
  while ((e = dummyElements.shift())) {
    if (e.parentNode) {
      e.parentNode.removeChild(e);
    }
  }
});

export const getWindow = function () {
  return window;
};

export const getDummyContainer = function () {
  var e = document.createElement("div");
  document.body.appendChild(e);
  dummyElements.push(e);
  return e;
};
// })();
