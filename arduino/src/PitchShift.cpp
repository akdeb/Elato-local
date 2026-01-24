#include "PitchShift.h"

#define GRAINSIZE 1024ul
static int16_t buf1[GRAINSIZE];
static int16_t buf2[GRAINSIZE];
static int16_t* buf = buf1;
static int16_t* buf_ = buf2;
static unsigned long readAddress = 0;
static unsigned long writeAddress = 0;

bool PitchShiftFixedOutput::begin(PitchShiftInfo info) {
  TRACED();
  cfg = info;
  AudioOutput::setAudioInfo(info);
  this->pitchMul = (uint32_t)(info.pitch_shift * 256.0f + 0.5f);
  //this->secondaryOffset = (uint32_t)( (1.0f - (info.pitch_shift - (int)(info.pitch_shift))) * GRAINSIZE + 0.5f);
  this->secondaryOffset = GRAINSIZE - ((( this->pitchMul * GRAINSIZE ) >> 8 ) % GRAINSIZE);
  
  return true;
}

int16_t PitchShiftFixedOutput::pitchShift(int16_t value) {

  buf_[writeAddress] = value;

  int ii1 = (writeAddress * this->pitchMul) >> 8;
  int output1 = buf[ii1 % GRAINSIZE];
  int ii2 = ii1 + secondaryOffset;
  int output2 = buf[ii2 % GRAINSIZE];

  unsigned long f = 0;
  if ( writeAddress >= GRAINSIZE*3/4 )
  {
    f = GRAINSIZE;
  }
  else if ( writeAddress >= GRAINSIZE/4 )
  {
    f = (writeAddress - GRAINSIZE/4) * 2;
  }

  int output = ( output1 * (GRAINSIZE - f ) + output2 * f )   /GRAINSIZE;

  writeAddress++;
  if (writeAddress >= GRAINSIZE)
  {
    writeAddress = 0; // loop around to beginning of grain
    readAddress = 0;

    buf_ = buf;
    buf = buf == buf1 ? buf2 : buf1;
  }

  return output;
}
