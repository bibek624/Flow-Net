import numpy as np
from matplotlib.patches import PathPatch, Polygon

class Domain():

    def __init__(self, L, H, Pw, Ww, Ws, Hs,  H1, H2,Nd, Nf, axes,  dx=0.1, dy=0.1,tolerance=0.0001, max_itern = 2000000):
        self.Nx = int(L/dx) 
        self.Ny = int(H/dy)  
        self.dx = dx
        self.dy = dy
        self.Ws = int(Ws/dx)
        self.Hs = int(Hs/dy)
        self.Pw = int(Pw/dx)
        self.Ww = int(Ww/dx)
        self.H1 = H1
        self.H2 = H2
        self.Nd = Nd
        self.Nf = Nf
        self.tolerance = tolerance
        self.max_itern = max_itern
        self.ax = axes
    

    def compute_potentials(self):
        h = np.zeros((self.Nx,self.Ny)) #potential head array
        for itn in range(self.max_itern):
            h_old = h.copy()

            #finite difference for total domain -- average of 4 neighbours 
            h[1:-1,1:-1] = ( h[1:-1,0:-2] + h[1:-1,2:] + h[0:-2,1:-1] + h[2:,1:-1] ) / 4
            
            #top boundary
            h[0:self.Pw+1,0] = self.H1
            h[self.Pw+self.Ww:,0] = self.H2
            #left boundary
            h[0,1:-1] = (h[0,0:-2] + h[0,2:] + 2*h[1,1:-1] ) *0.25 
            #right boundry
            h[self.Nx-1,1:-1] = (h[self.Nx-1,0:-2] + h[self.Nx-1,2:] + 2*h[self.Nx-2,1:-1] ) *0.25
            
            #bottom boundary
            i1 = 1
            i2 = self.Nx-1
            j = self.Ny-1
            h[i1:i2,j] = ( h[i1-1:i2-1,j] +h[i1+1:i2+1,j] + 2*h[i1:i2,j-1] ) * 0.25 
            
            #bottom corners 
            h[0,self.Ny-1] = ( h[0,self.Ny-2] + h[1,self.Ny-1] ) *0.5 
            h[self.Nx-1,self.Ny-1] = ( h[self.Nx-1,self.Ny-2] + h[self.Nx-2,self.Ny-1] ) *0.5
            
            #sheet pile left boundary
            h[self.Pw,1:self.Hs] = (h[self.Pw,0:self.Hs-1] + h[self.Pw,2:self.Hs+1] + 2*h[self.Pw-1,1:self.Hs])/4
            #sheet pile right boundary
            h[self.Pw+self.Ws,1:self.Hs] = (h[self.Pw+self.Ws,0:self.Hs-1] + h[self.Pw+self.Ws,2:self.Hs+1] + 2*h[self.Pw+self.Ws+1,1:self.Hs])/4
            #sheet pile bottom boundary
            h[self.Pw+1:self.Pw+self.Ws,self.Hs] = (h[self.Pw:self.Pw+self.Ws-1,self.Hs]+h[self.Pw+2:self.Pw+self.Ws+1,self.Hs] + 2*h[self.Pw+1:self.Pw+self.Ws,self.Hs+1])/4
            
            #sheet pile corners
            h[self.Pw,self.Hs] = ( 2 * h[self.Pw-1,self.Hs] + 2 * h[self.Pw, self.Hs+1] + h[self.Pw,self.Hs-1] + h[self.Pw+1, self.Hs] ) / 6 
            h[self.Pw+self.Ws,self.Hs] = ( 2 * h[self.Pw+self.Ws+1,self.Hs] + 2 * h[self.Pw+self.Ws, self.Hs+1] + h[self.Pw+self.Ws-1,self.Hs] + h[self.Pw+self.Ws, self.Hs-1] ) / 6 
            h[self.Pw+self.Ws-1,0] = ( h[self.Pw+self.Ws,0] + h[self.Pw+self.Ws-1,1] ) / 2 
            
            #weir bottom
            i1 = self.Pw+self.Ws
            i2 = self.Pw+self.Ww
            h[i1:i2,0] = ( h[i1-1:i2-1,0] + h[i1+1:i2+1,0] + 2* h[i1:i2,1] ) / 4 
        
            if np.max(np.abs(h - h_old)) < self.tolerance:
                break
            #overall 
        
        mask = np.zeros_like(h, dtype=bool)  
        mask[self.Pw+1:self.Pw+self.Ws, 0:self.Hs] = True
                    
        h = np.ma.masked_where(mask, h)
        return h

    def compute_flow(self):
        h = np.zeros((self.Nx,self.Ny)) #potential head array

        for itn in range(self.max_itern):
            h_old = h.copy()
            
            h[1:-1,1:-1] = ( h[1:-1,0:-2] + h[1:-1,2:] + h[0:-2,1:-1] + h[2:,1:-1] ) / 4
            
            #top boundary
            h[1:self.Pw,0] = ( h[0:self.Pw-1,0] + h[2:self.Pw+1,0] + 2 * h[1:self.Pw,1] ) / 4 
            h[self.Pw+self.Ww:-1,0] = ( h[self.Pw+self.Ww-1:-2,0] + h[self.Pw+self.Ww+1:,0] + 2 * h[self.Pw+self.Ww:-1,1] ) / 4 
        
            #top corners 
            h[0,0] = ( h[1,0] + h[0,1] ) / 2
            h[self.Nx-1, 0] = ( h[self.Nx-1, 0] + h[self.Nx-1, 1] ) / 2 
        
            h[self.Pw,0] = ( h[self.Pw-1,0] + h[self.Pw,1] ) / 2
            h[self.Pw,0] = self.H2
            #left boundary
            h[0,1:-1] = self.H1
            #right boundry
            h[self.Nx-1,1:-1] = self.H1
            
            #bottom boundary
            i1 = 1
            i2 = self.Nx-1
            j = self.Ny-1
            h[i1:i2,j] = self.H1
            
            #bottom corners 
            h[0,self.Ny-1] = self.H1
            h[self.Nx-1,self.Ny-1] = self.H1
            
            #sheet pile left boundary
            h[self.Pw,1:self.Hs] = self.H2
            #sheet pile right boundary
            h[self.Pw+self.Ws,1:self.Hs] = self.H2
            #sheet pile bottom boundary
            h[self.Pw+1:self.Pw+self.Ws,self.Hs] = self.H2
            
            #sheet pile corners
            h[self.Pw,self.Hs] = self.H2
            h[self.Pw+self.Ws,self.Hs] = self.H2
            h[self.Pw+self.Ws-1,0] = self.H2
            
            #weir bottom
            i1 = self.Pw+self.Ws
            i2 = self.Pw+self.Ww
            h[i1:i2,0] = self.H2
        
            if np.max(np.abs(h - h_old)) < self.tolerance:
                break
            #overall 
        
        mask = np.zeros_like(h, dtype=bool)  
        mask[self.Pw+1:self.Pw+self.Ws, 0:self.Hs] = True
                    
        f = np.ma.masked_where(mask, h)

        return f


    def draw_domain(self,h,f):

        weir_color = 'brown'
        water_color = 'blue'
        downstream_water_vertices = [
            (self.Pw,0),
            (self.Pw,-(self.H2)/self.dx),
            (self.Nx-1,-(self.H2)/self.dx),
            (self.Nx-1,0),
        ]
        
        down_water_patch = Polygon(downstream_water_vertices, closed=True, facecolor=water_color)
        self.ax.add_patch(down_water_patch)

        upstream_water_vertices = [
            (0,0),
            (0,-(self.H1)/self.dx),
            (self.Pw,-(self.H1)/self.dx),
            (self.Pw,0),
        ]
        
        polygon_patch = Polygon(upstream_water_vertices, closed=True, facecolor=water_color)
        self.ax.add_patch(polygon_patch)
        
        weir_vertices = [
            (self.Pw,0),
            (self.Pw,-(self.H1+1)/self.dx),
            (self.Pw+1/self.dx,-(self.H1+1)/self.dx),
            (self.Pw+self.Ww,0),
            (self.Pw,0)
        ]
        
        polygon_patch = Polygon(weir_vertices, closed=True, facecolor=weir_color)
        self.ax.add_patch(polygon_patch)
        
        
        

        #drawing sheet pile
        sheetpile_vertices = [
            (self.Pw,0),
            (self.Pw,(self.Hs)),
            (self.Pw+self.Ws,self.Hs),
            (self.Pw+self.Ws,0),
        ]
        
        polygon_patch = Polygon(sheetpile_vertices, closed=True, facecolor=weir_color)
        self.ax.add_patch(polygon_patch)
        
        #drawing equi potential lines
        contour = self.ax.contour(h.T, levels = self.Nd, cmap = 'hot', alpha = 0.6, linestyles = 'dashed')
        self.ax.clabel(contour, inline=True, fontsize=8)
        
        self.ax.contourf(f.T, levels = self.Nf, cmap = 'coolwarm')
        self.ax.contour(f.T, levels = self.Nf, cmap = 'hot', alpha = 0.4)
        self.ax.invert_yaxis()


        self.ax.set_xticks([])
        self.ax.set_yticks([])
        
        # Remove x and y tick labels
        self.ax.set_xticklabels([])
        self.ax.set_yticklabels([])
    
        self.ax.text(2, -int(self.H1/self.dy)-2, f'H= {self.H1} m', fontsize=10, color='black')
        self.ax.text(self.Pw+self.Ww+2, -int(self.H2/self.dy)-2, f'H= {self.H2} m', fontsize=10, color='black')
    
        

    def update(self, L, H, Pw, Ww, Ws, Hs, H1, H2, Nd, Nf, ax):
        self.Nx = int(L/self.dx) 
        self.Ny = int(H/self.dy)  
        self.Ws = int(Ws/self.dx)
        self.Hs = int(Hs/self.dy)
        self.Pw = int(Pw/self.dx)
        self.Ww = int(Ww/self.dx)
        self.H1 = H1
        self.H2 = H2
        self.Nd = Nd
        self.Nf = Nf
        self.ax = ax
       

