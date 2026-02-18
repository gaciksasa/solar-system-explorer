import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Planet } from '../models/planet.model';

interface ApiResponse {
  data: Planet[];
  count: number;
}

@Injectable({ providedIn: 'root' })
export class PlanetService {
  private http = inject(HttpClient);
  private apiUrl = '/api';

  getPlanets(): Observable<Planet[]> {
    return this.http.get<ApiResponse>(`${this.apiUrl}/planets`).pipe(
      map(response => response.data)
    );
  }

  getPlanet(name: string): Observable<Planet> {
    return this.http.get<{ data: Planet }>(`${this.apiUrl}/planets/${name}`).pipe(
      map(response => response.data)
    );
  }
}
