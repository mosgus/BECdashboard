export interface NBARow {
  game_id:       number;
  game_label:    string;
  market_type:   "moneyline" | "spread" | "total";
  ticker:        string;
  title:         string;
  kalshi_prob:   number;
  model_prob:    number;
  edge:          number;
  category:      "HOMERUN" | "UNDERVALUED" | "UNDERDOG" | "SHARP" | "FADE" | "LOW EDGE";
  american_odds: string;
  ev:            number;
  kelly:         number;
  volume:        number;
  stats_loaded:  boolean;
}

export interface NBAPredictionsResponse {
  games_count:   number;
  markets_count: number;
  positive_ev:   number;
  positive_edge: number;
  stats_loaded:  boolean;
  rows:          NBARow[];
}
