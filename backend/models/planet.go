package models

// Planet represents a celestial body in the solar system
type Planet struct {
	Name              string   `json:"name"`
	NameSR            string   `json:"name_sr"`
	Radius            float64  `json:"radius"`            // km
	DistanceFromSun   float64  `json:"distance_from_sun"` // AU (semi-major axis)
	OrbitalPeriod     float64  `json:"orbital_period"`    // Earth days
	RotationPeriod    float64  `json:"rotation_period"`   // Earth days
	Color             string   `json:"color"`             // hex color
	Description       string   `json:"description"`
	Satellites        int      `json:"satellites"`
	NotableSatellites []string `json:"notable_satellites"`
	IsStar            bool     `json:"is_star"`
	// Keplerian orbital elements (J2000 epoch)
	Eccentricity  float64 `json:"eccentricity"`   // 0 = circle, 1 = parabola
	Inclination   float64 `json:"inclination"`    // degrees, relative to ecliptic
	AscendingNode float64 `json:"ascending_node"` // degrees, longitude of ascending node (Ω)
}

// GetSolarSystemBodies returns all planets and the Sun with real NASA/J2000 data
func GetSolarSystemBodies() []Planet {
	return []Planet{
		{
			Name:              "Sun",
			NameSR:            "Sunce",
			Radius:            696000,
			DistanceFromSun:   0,
			OrbitalPeriod:     0,
			RotationPeriod:    25.38,
			Color:             "#FDB813",
			Description:       "Sunce je zvezda u centru Solarnog sistema. To je gotovo savršena sfera vruće plazme koja greje Zemlju i pruža energiju potrebnu za život.",
			Satellites:        0,
			NotableSatellites: []string{},
			IsStar:            true,
			Eccentricity:      0,
			Inclination:       0,
			AscendingNode:     0,
		},
		{
			Name:              "Mercury",
			NameSR:            "Merkur",
			Radius:            2439.7,
			DistanceFromSun:   0.387,
			OrbitalPeriod:     87.97,
			RotationPeriod:    58.65,
			Color:             "#B5B5B5",
			Description:       "Merkur je najbliža planeta Suncu i najmanji planet u Solarnom sistemu. Nema atmosferu, pa su temperature ekstremne - od -180°C do 430°C.",
			Satellites:        0,
			NotableSatellites: []string{},
			IsStar:            false,
			Eccentricity:      0.2056,
			Inclination:       7.005,
			AscendingNode:     48.331,
		},
		{
			Name:              "Venus",
			NameSR:            "Venera",
			Radius:            6051.8,
			DistanceFromSun:   0.723,
			OrbitalPeriod:     224.70,
			RotationPeriod:    -243.02,
			Color:             "#E8CDa2",
			Description:       "Venera je drugi planet od Sunca i najtopliji planet u Solarnom sistemu sa površinskom temperaturom od oko 465°C. Rotira u suprotnom smeru od većine planeta.",
			Satellites:        0,
			NotableSatellites: []string{},
			IsStar:            false,
			Eccentricity:      0.0068,
			Inclination:       3.395,
			AscendingNode:     76.680,
		},
		{
			Name:              "Earth",
			NameSR:            "Zemlja",
			Radius:            6371,
			DistanceFromSun:   1.000,
			OrbitalPeriod:     365.25,
			RotationPeriod:    1.00,
			Color:             "#2E86AB",
			Description:       "Zemlja je treći planet od Sunca i jedino poznato nebesko telo koje podržava život. 71% površine prekriva voda, a atmosfera je bogata kiseonikom.",
			Satellites:        1,
			NotableSatellites: []string{"Luna (Mesec)"},
			IsStar:            false,
			Eccentricity:      0.0167,
			Inclination:       0.000,
			AscendingNode:     174.873,
		},
		{
			Name:              "Mars",
			NameSR:            "Mars",
			Radius:            3389.5,
			DistanceFromSun:   1.524,
			OrbitalPeriod:     686.97,
			RotationPeriod:    1.03,
			Color:             "#C1440E",
			Description:       "Mars je četvrti planet od Sunca, poznat kao 'Crvena planeta'. Ima najvišu planinu u Solarnom sistemu - Olympus Mons (21 km visine).",
			Satellites:        2,
			NotableSatellites: []string{"Fobos", "Deimos"},
			IsStar:            false,
			Eccentricity:      0.0934,
			Inclination:       1.850,
			AscendingNode:     49.562,
		},
		{
			Name:            "Jupiter",
			NameSR:          "Jupiter",
			Radius:          69911,
			DistanceFromSun: 5.204,
			OrbitalPeriod:   4332.59,
			RotationPeriod:  0.41,
			Color:           "#C88B3A",
			Description:     "Jupiter je najveći planet u Solarnom sistemu. Čuvena Velika Crvena Mrlja je oluja koja traje više od 350 godina. Ima 4 velika Galilejeva meseca.",
			Satellites:      95,
			NotableSatellites: []string{
				"Io", "Evropa", "Ganimed", "Kalisto",
				"Amalthea", "Himalia",
			},
			IsStar:        false,
			Eccentricity:  0.0490,
			Inclination:   1.303,
			AscendingNode: 100.556,
		},
		{
			Name:            "Saturn",
			NameSR:          "Saturn",
			Radius:          58232,
			DistanceFromSun: 9.582,
			OrbitalPeriod:   10759.22,
			RotationPeriod:  0.44,
			Color:           "#E4D191",
			Description:     "Saturn je poznat po svom impresivnom sistemu prstenova koji se sastoje od leda i kamenja. Toliko je lak da bi plutao na vodi (gustina 0.69 g/cm³).",
			Satellites:      146,
			NotableSatellites: []string{
				"Titan", "Enceladus", "Mimas", "Dione",
				"Rhea", "Tethys", "Iapetus", "Hyperion",
			},
			IsStar:        false,
			Eccentricity:  0.0565,
			Inclination:   2.489,
			AscendingNode: 113.715,
		},
		{
			Name:            "Uranus",
			NameSR:          "Uran",
			Radius:          25362,
			DistanceFromSun: 19.201,
			OrbitalPeriod:   30688.5,
			RotationPeriod:  -0.72,
			Color:           "#7DE8E8",
			Description:     "Uran je ledeni gigant koji rotira na boku - njegova osa rotacije je nagnuta za 98°. Sateliti su nazvani po Šekspirovim i Popovim likovima.",
			Satellites:      27,
			NotableSatellites: []string{
				"Miranda", "Ariel", "Umbriel",
				"Titania", "Oberon",
			},
			IsStar:        false,
			Eccentricity:  0.0463,
			Inclination:   0.773,
			AscendingNode: 74.230,
		},
		{
			Name:            "Neptune",
			NameSR:          "Neptun",
			Radius:          24622,
			DistanceFromSun: 30.047,
			OrbitalPeriod:   60182,
			RotationPeriod:  0.67,
			Color:           "#3F54BA",
			Description:     "Neptun je najudaljeniji planet od Sunca. Ima najjače vetrove u Solarnom sistemu - do 2100 km/h. Jedan orbitalni period traje 165 Zemljinih godina.",
			Satellites:      16,
			NotableSatellites: []string{
				"Triton", "Nereid", "Proteus",
				"Larissa", "Galatea",
			},
			IsStar:        false,
			Eccentricity:  0.0097,
			Inclination:   1.770,
			AscendingNode: 131.722,
		},
	}
}
