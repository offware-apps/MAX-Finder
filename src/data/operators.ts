/**
 * Other operators whose trains an Interrail pass also takes, read from train-api next to
 * SNCF's (`<base>/<id>/<pass>/all.json`). Their stations keep the operator's own names,
 * except the ones SNCF also serves: those take SNCF's id, so a journey can change trains
 * there (Paris → Barcelona on a TGV, then Barcelona → Madrid on an AVE).
 */
export interface Operator {
  /** train-api's operator id. */
  id: string;
  /** Its name, as on its booking site. */
  name: string;
  /** Where its trains are booked. */
  bookingUrl: string;
  /** Its stations where a journey may change trains, by the operator's own names. */
  hubs: string[];
  /**
   * Its names for stations SNCF also serves, when they differ from SNCF's by more than
   * accents, case and punctuation (those join on their own), mapped to SNCF's id.
   */
  sncfNames: Record<string, string>;
  /** City names its main stations answer to in the station fields, by station id. */
  aliases: Record<string, string[]>;
}

/** Renfe: Spain's AVE, Alvia, Euromed, Avant and Intercity trains, and its trains into France. */
export const RENFE: Operator = {
  id: "renfe",
  name: "Renfe",
  bookingUrl: "https://www.renfe.com/es/en",
  hubs: [
    "Madrid-Puerta de Atocha-Almudena Grandes",
    "Madrid-Chamartín-Clara Campoamor",
    "Zaragoza Delicias",
    "Camp de Tarragona",
    "València-Joaquín Sorolla",
    "Córdoba-Julio Anguita",
    "Sevilla-Santa Justa",
    "Málaga María Zambrano",
  ],
  sncfNames: {
    "Lyon Part Dieu": "LYON (intramuros)",
    Nimes: "NIMES CENTRE",
    "Valence TGV": "VALENCE TGV AUVERGNE RHONE ALPES",
  },
  aliases: {
    "BARCELONA SANTS": ["barcelona", "barcelone"],
    "Madrid-Puerta de Atocha-Almudena Grandes": ["madrid"],
    "Zaragoza Delicias": ["zaragoza", "saragosse"],
    "València-Joaquín Sorolla": ["valencia"],
    "Sevilla-Santa Justa": ["sevilla", "seville", "séville"],
    "Córdoba-Julio Anguita": ["cordoba", "cordoue"],
    "Málaga María Zambrano": ["malaga"],
  },
};

const OPERATORS: Operator[] = [RENFE];

/** An operator by its train-api id; undefined for SNCF and unknown ids. */
export function operatorById(id: string | undefined): Operator | undefined {
  return id ? OPERATORS.find((o) => o.id === id) : undefined;
}
