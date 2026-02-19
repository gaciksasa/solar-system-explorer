# Istraživač Solarnog sistema

Interaktivna 3D vizuelizacija Solarnog sistema u realnom vremenu, izgrađena na Go backendu i Angular/Three.js frontendu.

![Solar System Explorer](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat&logo=go)
![Angular](https://img.shields.io/badge/Angular-19-DD0031?style=flat&logo=angular)
![Three.js](https://img.shields.io/badge/Three.js-r170-000000?style=flat&logo=threedotjs)

## Karakteristike

- **3D vizuelizacija** — Sunce, 8 planeta, 12 meseca, 3 komete, Asteroidni pojas i Ortov oblak
- **Keplerian orbite** — realni J2000 orbitalni elementi (ekscentricitet, nagib ekliptike, čvor)
- **Newton-Raphson solver** — tačno rešavanje Keplerove jednačine (15 iteracija za komete visokog e)
- **Komete sa repovima** — rep usmeren anti-solarno, dužina raste bliže Suncu
- **12 poznatih meseca** — kruže na proporcionalnim udaljenostima od matičnih planeta (Mesec, Fobos, Dejmos, Io, Evropa, Ganimede, Kalisto, Enkelad, Titan, Titanija, Oberon, Triton)
- **Dupli klik za zum** — automatski centrira i zumira na bilo koje telo (cubic ease-in-out animacija)
- **Interaktivna kamera** — rotacija, pomicanje i zum mišem (OrbitControls)
- **Hover & klik** — svim telima prikazuje tooltip i info panel sa podacima
- **Retrogradno kretanje** — Venera, Uran i Halleyjeva kometa (inklinacija 162°)
- **Simulacija brzine** — pauza ⏸, usporavanje i ubrzavanje vremena (0.5× do 64×)
- **Srpski jezik** — svi nazivi i opisi na srpskom

## Arhitektura

```
solar-system-explorer/
├── backend/                   # Go REST API
│   ├── main.go                # Gin server, CORS, rute
│   ├── go.mod
│   └── handlers/
│       └── planets.go         # /api/planets endpoint, svi podaci o planetama
└── frontend/                  # Angular aplikacija
    └── src/app/
        ├── models/
        │   └── planet.model.ts
        ├── services/
        │   └── planet.service.ts
        └── components/
            ├── solar-system/  # Three.js 3D scena
            └── planet-info/   # Info panel sa statistikama
```

## Pokretanje

### Preduslovi

- [Go 1.22+](https://go.dev/dl/)
- [Node.js 20+](https://nodejs.org/) i Angular CLI (`npm install -g @angular/cli`)

### Backend (Go API)

```bash
cd backend
go mod download
go run main.go
# API sluša na http://localhost:8080
```

### Frontend (Angular + Three.js)

```bash
cd frontend
npm install
ng serve
# Aplikacija dostupna na http://localhost:4200
```

## API endpoints

| Method | Path | Opis |
|--------|------|------|
| GET | `/api/planets` | Lista svih tela sa podacima |
| GET | `/api/planets/:name` | Podaci o jednom telu |

## Tehnologije

| Sloj | Tehnologije |
|------|------------|
| Backend | Go 1.22, Gin, gin-contrib/cors |
| Frontend | Angular 19 (standalone), Three.js, Angular Signals |
| Fizika | Keplerian orbital mechanics, Newton-Raphson solver (visoka e) |
| Orbitalni podaci | NASA J2000 elementi (ekscentricitet, inklinacija, čvor uzlazišta) |

## Kontrole

| Akcija | Kontrola |
|--------|----------|
| Rotacija scene | Levi klik + prevlačenje |
| Pomicanje scene | Desni klik + prevlačenje |
| Zum | Skrol točkić |
| Detalji tela | Klik na planetu / pojas |
| Zum na telo | Dupli klik na planetu / mesec / kometu |
| Brzina simulacije | Dugmad ◀◀ / ▶▶ u gornjem uglu (uključujući pauzu ⏸) |

## Tela u simulaciji

| Telo | Tip | Napomena |
|------|-----|----------|
| Sunce | Zvezda | Izvor svetlosti u centru |
| Merkur | Planeta | Najveća orbitalna ekscentricnost (e=0.206) |
| Venera | Planeta | Retrogradno kretanje |
| Zemlja | Planeta | Referentni period (365.25 dana) |
| Mars | Planeta | |
| Asteroidni pojas | Pojas | 2.2–3.2 AJ, ~2 800 čestica |
| Jupiter | Planeta | Najveća planeta |
| Saturn | Planeta | Vidljivi prstenovi (fiksirani nagib, ne rotiraju) |
| Uran | Planeta | Retrogradno kretanje |
| Neptun | Planeta | |
| Ortov oblak | Hipotetički | Vidljiv samo na najmanjem zumu |
| 1P/Halley | Kometa | Retrogradno (inc=162°), period 75.3 god., e=0.967 |
| 2P/Encke | Kometa | Najkraći period (~3.3 god.), prolazi bliže Suncu od Merkura |
| 67P/Čurjumov-Gerasimenko | Kometa | Cilj ESA misije Rozeta (2004–2016) |

### Meseci

| Mesec | Planeta | Napomena |
|-------|---------|----------|
| Mesec | Zemlja | Jedini prirodni satelit Zemlje |
| Fobos | Mars | Unutrašnji, period 7.6h |
| Dejmos | Mars | Spoljašnji, period 30.3h |
| Io | Jupiter | Najvolkanskije telo u SS |
| Evropa | Jupiter | Mogući podledeni okean |
| Ganimede | Jupiter | Najveći mesec u SS |
| Kalisto | Jupiter | Najstarija površina u SS |
| Enkelad | Saturn | Gejziri vodene pare |
| Titan | Saturn | Jedina atmosfera među mesecima |
| Titanija | Uran | Najveći Uranov mesec |
| Oberon | Uran | Drugi po veličini Uranov mesec |
| Triton | Neptun | Retrogradno (inc=156.84°) |

## Licenca

MIT
