"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};

function luminance(rgb) {
    const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return (0.2126 * toLinear(rgb.r) +
        0.7152 * toLinear(rgb.g) +
        0.0722 * toLinear(rgb.b));
}
function contrastRatio(fg, bg) {
    const L1 = luminance(fg);
    const L2 = luminance(bg);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}
function rgbToHex({ r, g, b }) {
    const toHex = (c) => Math.round(c * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
}

function isOverlapping(shape, text) {
    if (!("absoluteBoundingBox" in shape) || !("absoluteBoundingBox" in text)) {
        return false;
    }
    const s = shape.absoluteBoundingBox;
    const t = text.absoluteBoundingBox;
    if (!s || !t) {
        return false;
    }
    return (s.x < t.x + t.width &&
        s.x + s.width > t.x &&
        s.y < t.y + t.height &&
        s.y + s.height > t.y);
}
function findBackgroundShape(node, textNode) {
    if ("children" in node) {
        for (const child of node.children) {
            if (("fills" in child) &&
                (child.type === "RECTANGLE" || child.type === "ELLIPSE" ||
                    child.type === "POLYGON" || child.type === "STAR" ||
                    child.type === "FRAME" || child.type === "VECTOR" ||
                    child.type === "COMPONENT" || child.type === "STICKY" ||
                    child.type === "BOOLEAN_OPERATION") &&
                child.visible !== false &&
                child.id !== textNode.id &&
                isOverlapping(child, textNode)) {
                return child;
            }
            
            if (child.type === "GROUP" || child.type === "FRAME") {
                const found = findBackgroundShape(child, textNode);
                if (found)
                    return found;
            }
        }
    }
    return null;
}
function getBackgroundColor(textNode) {
    
    const parent = textNode.parent;
    if (!parent)
        return { r: 1, g: 1, b: 1 }; 
    const overlappingBackground = findBackgroundShape(parent, textNode);
    if (overlappingBackground && "fills" in overlappingBackground) {
        const fills = overlappingBackground.fills;
        if (Array.isArray(fills) && fills.length > 0) {
            const fill = fills[0];
            if (fill.type === "SOLID")
                return fill.color;
        }
    }
    
    if ("fills" in parent && Array.isArray(parent.fills) && parent.fills.length > 0) {
        const fill = parent.fills[0];
        if (fill.type === "SOLID")
            return fill.color;
    }
    return { r: 1, g: 1, b: 1 }; 
}
function findAllTextNodes(node) {
    let textNodes = [];
    if (node.type === "TEXT") {
        textNodes.push(node);
    }
    else if ("children" in node) {
        for (const child of node.children) {
            textNodes = textNodes.concat(findAllTextNodes(child));
        }
    }
    return textNodes;
}

figma.showUI(__html__, { width: 400, height: 1000 });
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (msg.type === "scan-contrast") {
        const mode = msg.mode;
        let textNodes = [];
        if (mode === "all") {
            textNodes = figma.currentPage.findAll(n => n.type === "TEXT");
        }
        else if (mode === "selected") {
            if (figma.currentPage.selection.length === 0) {
                figma.ui.postMessage({ type: "no-selection" });
                return;
            }
            for (const selectedNode of figma.currentPage.selection) {
                textNodes = textNodes.concat(findAllTextNodes(selectedNode));
            }
        }
        const results = [];
        for (const node of textNodes) {
            try {
                yield figma.loadFontAsync(node.fontName);
                const fills = node.fills;
                const fill = fills[0];
                if (!fill || fill.type !== "SOLID")
                    continue;
                const fgColor = fill.color;
                const bgColor = getBackgroundColor(node);
                const ratioValue = contrastRatio(fgColor, bgColor);
                const result = {
                    id: node.id,
                    text: node.characters,
                    font: `${node.fontName.family} ${String(node.fontSize)}px`,
                    fg: rgbToHex(fgColor),
                    bg: rgbToHex(bgColor),
                    fgRgb: fgColor,
                    bgRgb: bgColor,
                    ratio: ratioValue.toFixed(2),
                    passAA: ratioValue >= 4.5,
                    passAAA: ratioValue >= 7
                };
                results.push(result);
            }
            catch (e) {
                console.warn(`Error on node ${node.id}:`, e);
            }
        }
        figma.ui.postMessage({ type: "results", results });
    }
    if (msg.type === "apply-swatch" || msg.type === "apply-hex") {
        const { colorHex, target } = msg;
        const rgb = hexToRgb(colorHex);
        const selection = figma.currentPage.selection;
        for (const node of selection) {
            if (node.type !== "TEXT")
                continue;
            const paint = {
                type: "SOLID",
                color: rgb,
                opacity: 1
            };
            if (target === "fg") {
                node.fills = [paint];
            }
            else if (target === "bg" && node.parent && "fills" in node.parent) {
                const parent = node.parent;
                parent.fills = [paint];
            }
        }
    }
  
    if (msg.type === "select-text") {
        const node = figma.getNodeById(msg.nodeId);
        if (node) {
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
        }
    }
    
    if (msg.type === "apply-to-text") {
        console.log("Apply to Text button clicked");
        const selectedNode = figma.currentPage.selection[0];
        console.log("Selected Node:", selectedNode);
        if (!selectedNode || selectedNode.type !== "TEXT") {
            console.log("No valid text node selected.");
            return;
        }
        const selectedColor = msg.color;
        if (!selectedColor) {
            console.log("No color passed.");
            return;
        }
        const fills = [
            {
                type: "SOLID",
                color: {
                    r: selectedColor.r,
                    g: selectedColor.g,
                    b: selectedColor.b,
                },
                opacity: (_a = selectedColor.a) !== null && _a !== void 0 ? _a : 1,
            },
        ];
        console.log("Applying fills:", fills);
        selectedNode.fills = fills;
       
        try {
            yield figma.loadFontAsync(selectedNode.fontName);
            const fills = selectedNode.fills;
            const fill = fills[0];
            if (!fill || fill.type !== "SOLID")
                return;
            const fgColor = fill.color;
            const bgColor = getBackgroundColor(selectedNode);
            const ratioValue = contrastRatio(fgColor, bgColor);
            const result = {
                id: selectedNode.id,
                text: selectedNode.characters,
                font: `${selectedNode.fontName.family} ${String(selectedNode.fontSize)}px`,
                fg: rgbToHex(fgColor),
                bg: rgbToHex(bgColor),
                fgRgb: fgColor,
                bgRgb: bgColor,
                ratio: ratioValue.toFixed(2),
                passAA: ratioValue >= 4.5,
                passAAA: ratioValue >= 7
            };
           
            figma.ui.postMessage({ type: "node-updated", result });
        }
        catch (e) {
            console.warn(`Error updating node ${selectedNode.id}:`, e);
        }
    }
    if (msg.type === "apply-bg-to-text") {
        const selectedNode = figma.currentPage.selection[0];
        if (!selectedNode || selectedNode.type !== "TEXT") {
            figma.notify("Please select a text node");
            return;
        }
        const selectedColor = msg.color;
        if (!selectedColor) {
            figma.notify("No color provided");
            return;
        }
        const parent = selectedNode.parent;
        if (!parent) {
            figma.notify("Text node has no parent");
            return;
        }
       
        const overlappingBackground = findBackgroundShape(parent, selectedNode);
        let success = false;
        if (overlappingBackground) {
           
            overlappingBackground.fills = [{
                    type: "SOLID",
                    color: {
                        r: selectedColor.r,
                        g: selectedColor.g,
                        b: selectedColor.b,
                    },
                    opacity: selectedColor.a !== undefined ? selectedColor.a : 1,
                }];
            success = true;
        }
        else if ("fills" in parent && Array.isArray(parent.fills)) {
            parent.fills = [{
                    type: "SOLID",
                    color: {
                        r: selectedColor.r,
                        g: selectedColor.g,
                        b: selectedColor.b,
                    },
                    opacity: selectedColor.a !== undefined ? selectedColor.a : 1,
                }];
            success = true;
        }
        if (success) {
            figma.notify("Background updated successfully ✅");
            try {
                yield figma.loadFontAsync(selectedNode.fontName);
                const fills = selectedNode.fills;
                const fill = fills[0];
                if (!fill || fill.type !== "SOLID")
                    return;
                const fgColor = fill.color;
                const bgColor = getBackgroundColor(selectedNode);
                const ratioValue = contrastRatio(fgColor, bgColor);
                const result = {
                    id: selectedNode.id,
                    text: selectedNode.characters,
                    font: `${selectedNode.fontName.family} ${String(selectedNode.fontSize)}px`,
                    fg: rgbToHex(fgColor),
                    bg: rgbToHex(bgColor),
                    fgRgb: fgColor,
                    bgRgb: bgColor,
                    ratio: ratioValue.toFixed(2),
                    passAA: ratioValue >= 4.5,
                    passAAA: ratioValue >= 7
                };
                
                figma.ui.postMessage({ type: "node-updated", result });
            }
            catch (e) {
                console.warn(`Error updating node ${selectedNode.id}:`, e);
            }
        }
        else {
            figma.notify("No background shape or parent fill found ❌");
        }
    }
    if (msg.type === "rescan-node") {
        const nodeId = msg.nodeId;
        console.log("Received rescan request for node:", nodeId);
        const node = figma.getNodeById(nodeId);
        if (!node || node.type !== "TEXT") {
            console.log("Node not found or not a text node:", node);
            figma.notify("Node not found or not a text node");
            return;
        }
       
        try {
            console.log("Rescanning node:", node.id, node.name);
            yield figma.loadFontAsync(node.fontName);
            const textNode = node;
            const fills = textNode.fills;
            const fill = fills[0];
            if (!fill || fill.type !== "SOLID") {
                console.log("Text node has no solid fill");
                figma.notify("Text node has no solid fill");
                return;
            }
            const fgColor = fill.color;
            const bgColor = getBackgroundColor(textNode);
            console.log("Colors detected - FG:", fgColor, "BG:", bgColor);
            const ratioValue = contrastRatio(fgColor, bgColor);
            const result = {
                id: textNode.id,
                text: textNode.characters,
                font: `${textNode.fontName.family} ${String(textNode.fontSize)}px`,
                fg: rgbToHex(fgColor),
                bg: rgbToHex(bgColor),
                fgRgb: fgColor,
                bgRgb: bgColor,
                ratio: ratioValue.toFixed(2),
                passAA: ratioValue >= 4.5,
                passAAA: ratioValue >= 7
            };
            console.log("Sending rescanned result to UI:", result);
          
            figma.ui.postMessage({ type: "node-rescanned", result });
            figma.notify("Results refreshed ✅");
        }
        catch (e) {
            console.warn(`Error rescanning node ${nodeId}:`, e);
            figma.notify("Error refreshing results ❌");
        }
    }
});
