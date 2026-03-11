import { SVG } from "https://cdn.jsdelivr.net/npm/@svgdotjs/svg.js/+esm"

class SpringMassDamper extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
                    <style>
                        :host {
                            display: flex;
                            flex-direction: column;
                            background: white;
                            border: 1px solid #ddd;
                            border-radius: 8px;
                            padding: 1rem;
                            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                            font-family: system-ui, sans-serif;
                            color: black;
                        }
                        .container {
                            display: flex;
                            gap: 1rem;
                        }
                        .controls {
                            display: flex;
                            flex-direction: column;
                            gap: 0.5rem;
                            min-width: 200px;
                            background: #f9f9f9;
                            padding: 1rem;
                            border-radius: 6px;
                        }
                        .control-group {
                            display: flex;
                            flex-direction: column;
                        }
                        .control-group label {
                            font-size: 0.85rem;
                            font-weight: 600;
                            margin-bottom: 0.2rem;
                            display: flex;
                            justify-content: space-between;
                        }
                        #svg-container {
                            flex-grow: 1;
                            background: #fff;
                            border: 1px solid #eee;
                            border-radius: 4px;
                        }
                        .slider { width: 100%; }
                    </style>
                    <div class="container">
                        <div class="controls">
                            <div class="control-group">
                                <label>Mass (m) <span id="m-val">1.0</span></label>
                                <input type="range" id="m" class="slider" min="0.1" max="5" step="0.1" value="1">
                            </div>
                            <div class="control-group">
                                <label>Stiffness (k) <span id="k-val">20</span></label>
                                <input type="range" id="k" class="slider" min="1" max="100" step="1" value="20">
                            </div>
                            <div class="control-group">
                                <label>Damping (c) <span id="c-val">0</span></label>
                                <input type="range" id="c" class="slider" min="0" max="5" step="0.05" value="0">
                            </div>
                            <hr style="width: 100%; border: 0.5px solid #ddd;">
                            <div class="control-group">
                                <label>Forcing Amp (F₀) <span id="f-val">0</span></label>
                                <input type="range" id="f" class="slider" min="0" max="100" step="1" value="0">
                            </div>
                            <div class="control-group">
                                <label>Forcing Freq (ω_f) <span id="w-val">5.0</span></label>
                                <input type="range" id="w" class="slider" min="0.1" max="15" step="0.1" value="5">
                            </div>
                        </div>
                        <div id="svg-container"></div>
                    </div>
                `;

        this.x = 50;
        this.v = 0;
        this.t = 0;
        this.history = new Array(200).fill(this.x);
        this.historyForce = new Array(200).fill(this.x);
        this.animate = this.animate.bind(this);

        this.isDragging = false;
        this.visualScale = 2.5;
    }

    connectedCallback() {
        this.inputs = {
            m: this.shadowRoot.getElementById('m'),
            k: this.shadowRoot.getElementById('k'),
            c: this.shadowRoot.getElementById('c'),
            f: this.shadowRoot.getElementById('f'),
            w: this.shadowRoot.getElementById('w')
        };

        for (let key in this.inputs) {
            this.inputs[key].addEventListener('input', (e) => {
                this.shadowRoot.getElementById(`${key}-val`).textContent = e.target.value;
            });
        }

        this.initSVG();
        this.lastTime = performance.now();
        this.reqId = requestAnimationFrame(this.animate);
    }

    disconnectedCallback() {
        cancelAnimationFrame(this.reqId);
    }

    initSVG() {
        const container = this.shadowRoot.getElementById('svg-container');
        this.canvas = SVG().addTo(container).size('100%', '100%').viewbox(0, 0, 600, 300);

        this.canvas.line(200, 150, 600, 150).stroke({ color: '#ddd', width: 2 });
        this.canvas.line(200, 0, 200, 300).stroke({ color: '#333', width: 2 });

        this.spring = this.canvas.path().fill('none').stroke({ color: '#666', width: 3, linecap: 'round', linejoin: 'round' });
        this.mass = this.canvas.rect(60, 40).radius(4).fill('#3b82f6').stroke({ color: '#2563eb', width: 2 });
        this.mass.css('cursor', 'grab');

        // Restored the force vector arrow
        this.forceArrow = this.canvas.path().fill('none').stroke({ color: '#ef4444', width: 3, linecap: 'round', linejoin: 'round' });
        this.plotLine = this.canvas.polyline().fill('none').stroke({ color: '#3b82f6', width: 2, linecap: 'round', linejoin: 'round' });
        this.plotLineForce = this.canvas.polyline().fill('none').stroke({ color: '#ef4444', width: 2, linecap: 'round', linejoin: 'round' });

        this.mass.node.addEventListener('pointerdown', (e) => {
            this.isDragging = true;
            this.v = 0; // Arrest any current momentum
            this.mass.node.setPointerCapture(e.pointerId); // Lock cursor to this element
            this.mass.css('cursor', 'grabbing');
        });

        this.mass.node.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;

            // Map screen pixels to SVG viewBox coordinates
            const rect = container.getBoundingClientRect();
            const svgY = (e.clientY - rect.top) * (300 / rect.height);

            // Reverse the math from updateGraphics to find actual x
            const originY = 150;
            this.x = (svgY - originY) / this.visualScale;
        });

        this.mass.node.addEventListener('pointerup', (e) => {
            this.isDragging = false;
            this.mass.node.releasePointerCapture(e.pointerId);
            this.mass.css('cursor', 'grab');
        });
    }

    animate(currentTime) {
        const dt = Math.min((currentTime - this.lastTime) / 1000, 0.05);
        this.lastTime = currentTime;

        const m = parseFloat(this.inputs.m.value);
        const k = parseFloat(this.inputs.k.value);
        const c = parseFloat(this.inputs.c.value);
        const F0 = parseFloat(this.inputs.f.value);
        const wf = parseFloat(this.inputs.w.value);
        if (!this.isDragging) {
            const subSteps = 10;
            const subDt = dt / subSteps;

            for (let i = 0; i < subSteps; i++) {
                let force = F0 * Math.cos(wf * this.t) - c * this.v - k * this.x;
                let a = force / m;

                this.v += a * subDt;
                this.x += this.v * subDt;
                this.t += subDt;
            }

        } else {
            this.t += dt;

        }
        this.history.push(this.x);
        this.history.shift();

        this.historyForce.push(F0 * Math.cos(wf * this.t));
        this.historyForce.shift();

        this.updateGraphics(F0, wf);
        this.reqId = requestAnimationFrame(this.animate);
    }

    updateGraphics(F0, wf) {
        const originY = 150;
        const originX = 100;

        // Restored Visual Scaling: Magnifies the raw physics displacement for the screen
        const visualScale = 2.5;
        const visualX = this.x * visualScale;

        // 1. Move Mass
        this.mass.move(originX - 30, originY + visualX - 20);

        // 2. Redraw Spring Path
        const springEnd = originY + visualX - 20;
        const coils = 10;
        const coilLength = (springEnd - 40) / coils;

        let pathD = `M ${originX} 0 L ${originX} 20 `;
        for (let i = 0; i < coils; i++) {
            let yPos = 20 + i * coilLength + coilLength / 2;
            let xOffset = (i % 2 === 0) ? 20 : -20;
            pathD += `L ${originX + xOffset} ${yPos} `;
        }
        pathD += `L ${originX} ${springEnd - 20} L ${originX} ${springEnd}`;
        this.spring.plot(pathD);

        // 3. Update Force Arrow
        const currentForce = F0 * Math.cos(wf * this.t);
        let fArrowD = "";

        // Only draw the arrow if the force is non-zero
        if (Math.abs(currentForce) > 0.1) {
            const attachY = originY + visualX + 20; // Attach to the bottom of the mass
            const tipY = attachY + currentForce;
            const dir = currentForce > 0 ? 1 : -1;

            // Draw stem and dynamic arrowhead
            fArrowD = `M ${originX} ${attachY} L ${originX} ${tipY} M ${originX} ${tipY} L ${originX - 6} ${tipY - 6 * dir} M ${originX} ${tipY} L ${originX + 6} ${tipY - 6 * dir}`;
        }
        this.forceArrow.plot(fArrowD);

        // 4. Redraw Plot Line
        const plotStartX = 200;
        const plotWidth = 400;
        const stepX = plotWidth / (this.history.length - 1);

        const points = this.history.map((val, index) => [
            plotStartX + index * stepX,
            originY + (val * visualScale) // Scale the plot to match the mass
        ]);
        this.plotLine.plot(points);

        const pointsForce = this.historyForce.map((val, index) => [
            plotStartX + index * stepX,
            originY + (val * visualScale) // Scale the plot to match the mass
        ]);
        this.plotLineForce.plot(pointsForce);
    }
}

customElements.define('spring-mass-damper', SpringMassDamper);