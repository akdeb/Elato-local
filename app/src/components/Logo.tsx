import logoPng from '../assets/logo.png';

export const Logo = () => {
  return (
              <div className="flex items-center justify-center gap-2">
            <img src={logoPng} alt="" className="w-8 h-8" />
            <h1 className="text-2xl tracking-wider brand-font mt-1 text-black">ELATO</h1>
          </div>
  );
};