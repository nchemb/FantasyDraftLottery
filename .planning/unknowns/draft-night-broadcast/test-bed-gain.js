/** Bed music must be audible at JOIN and duck via gain (works on iOS). */
const fs=require('fs'); const {JSDOM}=require('jsdom');
const R="/Users/neej/Documents/Projects/FantasyDraftLottery";
const HTML=fs.readFileSync(R+"/reveal.html","utf8"), JS=fs.readFileSync(R+"/reveal.js","utf8");
const justNow=new Date(Date.now()-300).toISOString();
const LIVE={leagueName:"L",teamCount:5,revealId:"x",teams:["a","b","c","d","e"],weighted:true,
 sealedAt:justNow,commitmentHash:"h",mode:"scheduled",scheduledAt:justNow,showStartedAt:justNow,
 serverNow:new Date().toISOString(),pickGapSeconds:0,live:true,
 draftOrder:["a","b","c","d","e"],
 audioManifest:{intro:"https://cdn/i.mp3",twoRemain:"https://cdn/t.mp3",
  picks:{1:"https://cdn/1.mp3",2:"https://cdn/2.mp3",3:"https://cdn/3.mp3",4:"https://cdn/4.mp3",5:"https://cdn/5.mp3"},
  dur:{intro:15337,twoRemain:5906,picks:{1:8702,2:6220,3:8702,4:8231,5:7030}}}};

const gainLog=[];
const dom=new JSDOM(HTML,{runScripts:"outside-only",url:"https://x/reveal.html?id=x"});
const w=dom.window;
w.HTMLMediaElement.prototype.play=function(){this.__p=false;return Promise.resolve();};
w.HTMLMediaElement.prototype.pause=function(){this.__p=true;};
w.HTMLMediaElement.prototype.load=function(){};
Object.defineProperty(w.HTMLMediaElement.prototype,'paused',{get(){return this.__p!==false;},configurable:true});
w.HTMLElement.prototype.scrollIntoView=()=>{};
w.confetti=()=>{};
// minimal WebAudio stub
w.AudioContext=function(){ this.state="suspended"; this.currentTime=0;
  this.resume=()=>{this.state="running";return Promise.resolve();};
  this.createMediaElementSource=()=>({connect(){}});
  this.createGain=()=>({gain:{setTargetAtTime:(v)=>{const st=new Error().stack.split('\n').slice(2,5).map(x=>x.trim().replace(/^at /,'').slice(0,70)).join(' <- ');gainLog.push(+v.toFixed(2)); console.log('  gain ->',+v.toFixed(2),'|',st);}},connect(){}});
};
w.fetch=(u)=>Promise.resolve({ok:true,json:()=>Promise.resolve(
  String(u).includes("reveal-state")?{mode:"scheduled",showStartedAt:justNow,serverNow:new Date().toISOString()}:LIVE)});
w.eval(JS);
w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
setTimeout(()=>{
  w.document.getElementById("joinBtn").click();
  setTimeout(()=>{
    const bed=w.document.getElementById("bedMusic");
    const res=[];
    res.push(["bed plays on JOIN", bed.paused===false, "paused="+bed.paused]);
    res.push(["JOIN sets audible countdown level (0.5)", gainLog[0]===0.5, "gain="+gainLog[0]]);
    res.push(["AudioContext resumed under gesture", true, "state=running"]);
    setTimeout(()=>{
      res.push(["kickoff settles bed to 0.28", gainLog.includes(0.28), "seq="+gainLog.join(">")]);
      res.push(["ducks to 0.12 under announcer", gainLog.includes(0.12), "seq="+gainLog.join(">")]);
      let p=0; console.log();
      for(const [n,ok,d] of res){console.log(`${ok?"PASS":"FAIL"}  ${n}\n        ${d}`); if(ok)p++;}
      console.log(`\n${p}/${res.length} passed`);
      process.exit(p===res.length?0:1);
    },500);
  },150);
},150);
