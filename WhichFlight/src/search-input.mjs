import {validateQuery} from './core.mjs';

export async function resolveSearchInput(input,interpret){
  const interpretation=input.query
    ?{query:validateQuery(input.query),notes:[],model:null,interpretationMs:0}
    :await interpret(input.text);
  // An explicit checked filter wins over model output. Clone cached interpretations
  // so checking the box cannot change another request for the same travel text.
  return input.nonstop===true
    ?{...interpretation,query:{...interpretation.query,nonstop:true}}
    :interpretation;
}
