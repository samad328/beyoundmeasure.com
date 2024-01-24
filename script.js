import {Curtains, Plane, RenderTarget,Vec2, ShaderPass} from 'https://cdn.jsdelivr.net/npm/curtainsjs@8.1.2/src/index.mjs';
import {TextTexture} from 'https://gistcdn.githack.com/martinlaxenaire/549b3b01ff4bd9d29ce957edd8b56f16/raw/2f111abf99c8dc63499e894af080c198755d1b7a/TextTexture.js';

gsap.registerPlugin(ScrollTrigger);

window.addEventListener("load", () => {
  // track the mouse positions to send it to the shaders
  const mousePosition = new Vec2();
  // we will keep track of the last position in order to calculate the movement strength/delta
  const mouseLastPosition = new Vec2();

  const deltas = {
      max: 0,
      applied: 0,
  };

  // set up our WebGL context and append the canvas to our wrapper
  const curtains = new Curtains({
      container: "canvas",
      watchScroll: false, // no need to listen for the scroll in this example
      pixelRatio: Math.min(1.5, window.devicePixelRatio) // limit pixel ratio for performance
  });

  // handling errors
  curtains.onError(() => {
      // we will add a class to the document body to display original images
      document.body.classList.add("no-curtains");
  }).onContextLost(() => {
      // on context lost, try to restore the context
      curtains.restoreContext();
  });

  // get our plane element
  const planeElements = document.getElementsByClassName("curtain");



  const vs = `
      precision mediump float;

      // default mandatory variables
      attribute vec3 aVertexPosition;
      attribute vec2 aTextureCoord;

      uniform mat4 uMVMatrix;
      uniform mat4 uPMatrix;
      
      // our texture matrix uniform
      uniform mat4 simplePlaneTextureMatrix;

      // custom variables
      varying vec3 vVertexPosition;
      varying vec2 vTextureCoord;

      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uMousePosition;
      uniform float uMouseMoveStrength;


      void main() {

          vec3 vertexPosition = aVertexPosition;

          // get the distance between our vertex and the mouse position
          float distanceFromMouse = distance(uMousePosition, vec2(vertexPosition.x, vertexPosition.y));

          // calculate our wave effect
          float waveSinusoid = cos(5.0 * (distanceFromMouse - (uTime / 75.0)));

          // attenuate the effect based on mouse distance
          float distanceStrength = (0.4 / (distanceFromMouse + 0.4));

          // calculate our distortion effect
          float distortionEffect = distanceStrength * waveSinusoid * uMouseMoveStrength;

          // apply it to our vertex position
          vertexPosition.z +=  distortionEffect / 30.0;
          vertexPosition.x +=  (distortionEffect / 30.0 * (uResolution.x / uResolution.y) * (uMousePosition.x - vertexPosition.x));
          vertexPosition.y +=  distortionEffect / 30.0 * (uMousePosition.y - vertexPosition.y);

          gl_Position = uPMatrix * uMVMatrix * vec4(vertexPosition, 1.0);

          // varyings
          vTextureCoord = (simplePlaneTextureMatrix * vec4(aTextureCoord, 0.0, 1.0)).xy;
          vVertexPosition = vertexPosition;
      }
  `;

  const fs = `
      precision mediump float;

      varying vec3 vVertexPosition;
      varying vec2 vTextureCoord;

      uniform sampler2D simplePlaneTexture;

      void main() {
          // apply our texture
          vec4 finalColor = texture2D(simplePlaneTexture, vTextureCoord);

          // fake shadows based on vertex position along Z axis
          finalColor.rgb -= clamp(-vVertexPosition.z, 0.0, 1.0);
          // fake lights based on vertex position along Z axis
          finalColor.rgb += clamp(vVertexPosition.z, 0.0, 1.0);

          // handling premultiplied alpha (useful if we were using a png with transparency)
          finalColor = vec4(finalColor.rgb * finalColor.a, finalColor.a);

          gl_FragColor = finalColor;
      }
  `;

  // some basic parameters
  const params = {
      vertexShader: vs,
      fragmentShader: fs,
      widthSegments: 20,
      heightSegments: 20,
      uniforms: {
          resolution: { // resolution of our plane
              name: "uResolution",
              type: "2f", // notice this is an length 2 array of floats
              value: [planeElements[0].clientWidth, planeElements[0].clientHeight],
          },
          
          time: { // time uniform that will be updated at each draw call
              name: "uTime",
              type: "1f",
              value: 0,
          },
          mousePosition: { // our mouse position
              name: "uMousePosition",
              type: "2f", // again an array of floats
              value: mousePosition,
          },
          mouseMoveStrength: { // the mouse move strength
              name: "uMouseMoveStrength",
              type: "1f",
              value: 0,
          }
      }
  };

  // create our plane
  const simplePlane = new Plane(curtains, planeElements[0], params);

  // if there has been an error during init, simplePlane will be null
  simplePlane.onReady(() => {
      // set a fov of 35 to reduce perspective (we could have used the fov init parameter)
      simplePlane.setPerspective(35);

      // apply a little effect once everything is ready
      deltas.max = 2;

      // now that our plane is ready we can listen to mouse move event
      const wrapper = document.getElementById("page-wrap");
      console.log(wrapper)

      wrapper.addEventListener("mousemove", (e) => {
          handleMovement(e, simplePlane);
      });

      wrapper.addEventListener("touchmove", (e) => {
          handleMovement(e, simplePlane);
      }, {
          passive: true
      });

  }).onRender(() => {
      // increment our time uniform
      simplePlane.uniforms.time.value++;

      // decrease both deltas by damping : if the user doesn't move the mouse, effect will fade away
      deltas.applied += (deltas.max - deltas.applied) * 0.02;
      deltas.max += (0 - deltas.max) * 0.01;

      // send the new mouse move strength value
      simplePlane.uniforms.mouseMoveStrength.value = deltas.applied;

  }).onAfterResize(() => {
      const planeBoundingRect = simplePlane.getBoundingRect();
      simplePlane.uniforms.resolution.value = [planeBoundingRect.width, planeBoundingRect.height];
  }).onError(() => {
      // we will add a class to the document body to display original images
      document.body.classList.add("no-curtains");
  });

  // handle the mouse move event
  function handleMovement(e, plane) {
      // update mouse last pos
      mouseLastPosition.copy(mousePosition);

      const mouse = new Vec2();

      // touch event
      if(e.targetTouches) {
          mouse.set(e.targetTouches[0].clientX, e.targetTouches[0].clientY);
      }
      // mouse event
      else {
          mouse.set(e.clientX, e.clientY);
      }

      // lerp the mouse position a bit to smoothen the overall effect
      mousePosition.set(
          curtains.lerp(mousePosition.x, mouse.x, 0.3),
          curtains.lerp(mousePosition.y, mouse.y, 0.3)
      );

      // convert our mouse/touch position to coordinates relative to the vertices of the plane and update our uniform
      plane.uniforms.mousePosition.value = plane.mouseToPlaneCoords(mousePosition);

      // calculate the mouse move strength
      if(mouseLastPosition.x && mouseLastPosition.y) {
          let delta = Math.sqrt(Math.pow(mousePosition.x - mouseLastPosition.x, 2) + Math.pow(mousePosition.y - mouseLastPosition.y, 2)) / 30;
          delta = Math.min(4, delta);
          // update max delta only if it increased
          if(delta >= deltas.max) {
              deltas.max = delta;
          }
      }
  }
});

const lenis = new Lenis()

lenis.on('scroll', (e) => {
  console.log(e)
})

lenis.on('scroll', ScrollTrigger.update)

gsap.ticker.add((time)=>{
  lenis.raf(time * 1000)
})

gsap.ticker.lagSmoothing(0)


// const locoScroll = new LocomotiveScroll({
//   el: document.querySelector("[data-scroll-container]"),
//   smooth: true,

//   // for tablet smooth
//   tablet: { smooth: true },

//   // for mobile
//   smartphone: { smooth: true }
// });
// locoScroll.on("scroll", ScrollTrigger.update);

// ScrollTrigger.scrollerProxy("[data-scroll-container]", {
//   scrollTop(value) {
//     return arguments.length
//       ? locoScroll.scrollTo(value, 0, 0)
//       : locoScroll.scroll.instance.scroll.y;
//   },
//   getBoundingClientRect() {
//     return {
//       top: 0,
//       left: 0,
//       width: window.innerWidth,
//       height: window.innerHeight
//     };
//   }

//   // follwoing line is not required to work pinning on touch screen

//   /* pinType: document.querySelector("[data-scroll-container]").style.transform
//     ? "transform"
//     : "fixed"*/
// });

// // --- RED PANEL ---
// initScrollLetters()


// ScrollTrigger.addEventListener("refresh", () => locoScroll.update());

// ScrollTrigger.refresh();


// Function BigText-Scroll

function initScrollLetters() {
  // Scrolling Letters Both Direction
  // https://codepen.io/GreenSock/pen/rNjvgjo
  // Fixed example with resizing
  // https://codepen.io/GreenSock/pen/QWqoKBv?editors=0010

  let direction = 1; // 1 = forward, -1 = backward scroll

  const roll1 = roll(" .name-wrap", {duration: 18}),
        roll2 = roll(".rollingText02", {duration: 10}, true),
        scroll = ScrollTrigger.create({
          trigger: document.querySelector('[data-scroll-container]'),
          onUpdate(self) {
            if (self.direction !== direction) {
              direction *= -1;
              gsap.to([roll1, roll2], {timeScale: direction, overwrite: true});
            }
          }
        });

  // helper function that clones the targets, places them next to the original, then animates the xPercent in a loop to make it appear to roll across the screen in a seamless loop.
  function roll(targets, vars, reverse) {
    vars = vars || {};
    vars.ease || (vars.ease = "none");
    const tl = gsap.timeline({
            repeat: -1,
            onReverseComplete() { 
              this.totalTime(this.rawTime() + this.duration() * 10); // otherwise when the playhead gets back to the beginning, it'd stop. So push the playhead forward 10 iterations (it could be any number)
            }
          }), 
          elements = gsap.utils.toArray(targets),
          clones = elements.map(el => {
            let clone = el.cloneNode(true);
            el.parentNode.appendChild(clone);
            return clone;
          }),
          positionClones = () => elements.forEach((el, i) => gsap.set(clones[i], {position: "absolute", overwrite: false, top: el.offsetTop, left: el.offsetLeft + (reverse ? -el.offsetWidth : el.offsetWidth)}));
    positionClones();
    elements.forEach((el, i) => tl.to([el, clones[i]], {xPercent: reverse ? 100 : -100, ...vars}, 0));
    window.addEventListener("resize", () => {
      let time = tl.totalTime(); // record the current time
      tl.totalTime(0); // rewind and clear out the timeline
      positionClones(); // reposition
      tl.totalTime(time); // jump back to the proper time
    });
    return tl;
  }

}
initScrollLetters() 

// gsap.fromTo(
//   '.char',
//   { 
//     x: 100,
//     opacity: 0
//   },
//   {
//     x: 0,
//     opacity: 1,
//     stagger: 0.05,
//     duration: 2,
//     ease: 'power4.out',
//   }
// )


function initTricksWords(scrolltrigger) {
    
  // Copyright start
  // © Code by T.RICKS, https://www.tricksdesign.com/
  // You have the license to use this code in your projects but not redistribute it to others
  // Tutorial: https://www.youtube.com/watch?v=xiAqTu4l3-g&ab_channel=TimothyRicks

  // Find all text with .tricks class and break each letter into a span
  var spanWord = document.getElementsByClassName("span-lines");
  for (var i = 0; i < spanWord.length; i++) {

  var wordWrap = spanWord.item(i);
  wordWrap.innerHTML = wordWrap.innerHTML.replace(/(^|<\/?[^>]+>|\s+)([^\s<]+)/g, '$1<span class="span-line"><span class="span-line-inner">$2</span></span>');

  }
  scrolltrigger()
}


const fx18Titles = document.querySelectorAll('.sn');


fx18Titles.forEach(title => {
  const chars = title.querySelectorAll('.char-w');
  let tl = gsap.timeline({
    scrollTrigger: {
      trigger: title,
      // toggleActions:'play none none reset', 
      start: "0% 100%",
      end: "100% 0%",

    }
  });

tl.fromTo(
  chars,
  { 
    x: 100,
    opacity: 0
  },
  {
    x: 0,
    opacity: 1,
    stagger: 0.05,
    duration: 2,
    ease: 'power4.out',
   
  }
)

});


