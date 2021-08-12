"use strict"

var pool = require("typedarray-pool")

var INSERTION_SORT_THRESHOLD = 32

function getMallocFree(dtype) {
  switch(dtype) {
    case "uint8":
      return [pool.mallocUint8, pool.freeUint8]
    case "uint16":
      return [pool.mallocUint16, pool.freeUint16]
    case "uint32":
      return [pool.mallocUint32, pool.freeUint32]
    case "int8":
      return [pool.mallocInt8, pool.freeInt8]
    case "int16":
      return [pool.mallocInt16, pool.freeInt16]
    case "int32":
      return [pool.mallocInt32, pool.freeInt32]
    case "float32":
      return [pool.mallocFloat, pool.freeFloat]
    case "float64":
      return [pool.mallocDouble, pool.freeDouble]
    default:
      return null
  }
}

function shapeArgs(dimension) {
  var args = []
  for(var i=0; i<dimension; ++i) {
    args.push("s"+i)
  }
  for(var i=0; i<dimension; ++i) {
    args.push("n"+i)
  }
  for(var i=1; i<dimension; ++i) {
    args.push("d"+i)
  }
  for(var i=1; i<dimension; ++i) {
    args.push("e"+i)
  }
  for(var i=1; i<dimension; ++i) {
    args.push("f"+i)
  }
  return args
}

var CACHED_insertionSort = {
  "uint32,1,0": function (malloc, free) {
    return function ndarrayInsertionSort1d0uint32(left, right, data, offset, s0, s1, n0, n1, d1, e1, f1) {
      var i,
        j,
        cptr,
        ptr = left * s0 + offset,
        i1,
        scratch = malloc(n1),
        dptr,
        sptr,
        a,
        b
      for (i = left + 1; i <= right; ++i) {
        j = i
        ptr += s0
        cptr = ptr
        dptr = 0
        sptr = ptr
        for (i1 = 0; i1 < n1; ++i1) {
          scratch[dptr++] = data[sptr]
          sptr += d1
        }
        __g: while (j-- > left) {
          dptr = 0
          sptr = cptr - s0
          __l: for (i1 = 0; i1 < n1; ++i1) {
            a = data[sptr]
            b = scratch[dptr]
            if (a < b) {
              break __g
            }
            if (a > b) {
              break __l
            }
            sptr += e1
            dptr += f1
          }
          dptr = cptr
          sptr = cptr - s0
          for (i1 = 0; i1 < n1; ++i1) {
            data[dptr] = data[sptr]
            dptr += d1
            sptr += d1
          }
          cptr -= s0
        }
        dptr = cptr
        sptr = 0
        for (i1 = 0; i1 < n1; ++i1) {
          data[dptr] = scratch[sptr++]
          dptr += d1
        }
      }
      free(scratch)
    }
  },
}

function createInsertionSort(order, dtype) {
  var key = [dtype, order].join(',')

  var code = ["'use strict'"]
  var funcName = ["ndarrayInsertionSort", order.join("d"), dtype].join("")
  var funcArgs = ["left", "right", "data", "offset" ].concat(shapeArgs(order.length))
  var allocator = getMallocFree(dtype)

  var vars = [ "i,j,cptr,ptr=left*s0+offset" ]

  if(order.length > 1) {
    var scratch_shape = []
    for(var i=1; i<order.length; ++i) {
      vars.push("i"+i)
      scratch_shape.push("n"+i)
    }
    if(allocator) {
      vars.push("scratch=malloc(" + scratch_shape.join("*") + ")")
    } else {
      vars.push("scratch=new Array("+scratch_shape.join("*") + ")")
    }
    vars.push("dptr","sptr","a","b")
  } else {
    vars.push("scratch")
  }

  function dataRead(ptr) {
    if(dtype === "generic") {
      return ["data.get(", ptr, ")"].join("")
    }
    return ["data[",ptr,"]"].join("")
  }

  function dataWrite(ptr, v) {
    if(dtype === "generic") {
      return ["data.set(", ptr, ",", v, ")"].join("")
    }
    return ["data[",ptr,"]=",v].join("")
  }

  //Create function header
  code.push(
    ["function ", funcName, "(", funcArgs.join(","), "){var ", vars.join(",")].join(""),
      "for(i=left+1;i<=right;++i){",
        "j=i;ptr+=s0",
        "cptr=ptr")


  if(order.length > 1) {

    //Copy data into scratch
    code.push("dptr=0;sptr=ptr")
    for(var i=order.length-1; i>=0; --i) {
      var j = order[i]
      if(j === 0) {
        continue
      }
      code.push(["for(i",j,"=0;i",j,"<n",j,";++i",j,"){"].join(""))
    }
    code.push("scratch[dptr++]=",dataRead("sptr"))
    for(var i=0; i<order.length; ++i) {
      var j = order[i]
      if(j === 0) {
        continue
      }
      code.push("sptr+=d"+j,"}")
    }


    //Compare items in outer loop
    code.push("__g:while(j-->left){",
              "dptr=0",
              "sptr=cptr-s0")
    for(var i=1; i<order.length; ++i) {
      if(i === 1) {
        code.push("__l:")
      }
      code.push(["for(i",i,"=0;i",i,"<n",i,";++i",i,"){"].join(""))
    }
    code.push(["a=", dataRead("sptr"),"\nb=scratch[dptr]\nif(a<b){break __g}\nif(a>b){break __l}"].join(""))
    for(var i=order.length-1; i>=1; --i) {
      code.push(
        "sptr+=e"+i,
        "dptr+=f"+i,
        "}")
    }

    //Copy data back
    code.push("dptr=cptr;sptr=cptr-s0")
    for(var i=order.length-1; i>=0; --i) {
      var j = order[i]
      if(j === 0) {
        continue
      }
      code.push(["for(i",j,"=0;i",j,"<n",j,";++i",j,"){"].join(""))
    }
    code.push(dataWrite("dptr", dataRead("sptr")))
    for(var i=0; i<order.length; ++i) {
      var j = order[i]
      if(j === 0) {
        continue
      }
      code.push(["dptr+=d",j,";sptr+=d",j].join(""),"}")
    }

    //Close while loop
    code.push("cptr-=s0\n}")

    //Copy scratch into cptr
    code.push("dptr=cptr;sptr=0")
    for(var i=order.length-1; i>=0; --i) {
      var j = order[i]
      if(j === 0) {
        continue
      }
      code.push(["for(i",j,"=0;i",j,"<n",j,";++i",j,"){"].join(""))
    }
    code.push(dataWrite("dptr", "scratch[sptr++]"))
    for(var i=0; i<order.length; ++i) {
      var j = order[i]
      if(j === 0) {
        continue
      }
      code.push("dptr+=d"+j,"}")
    }
  } else {
    code.push("scratch=" + dataRead("ptr"),
              "while((j-->left)&&("+dataRead("cptr-s0")+">scratch)){",
                dataWrite("cptr", dataRead("cptr-s0")),
                "cptr-=s0",
              "}",
              dataWrite("cptr", "scratch"))
  }

  //Close outer loop body
  code.push("}")
  if(order.length > 1 && allocator) {
    code.push("free(scratch)")
  }
  code.push("} return " + funcName)

  var result = CACHED_insertionSort[key]
  if (!result) {
    //Compile and link function
    if(allocator) {
      result = new Function("malloc", "free", code.join("\n"))
    } else {
      result = new Function(code.join("\n"))
    }
    console.log(key, result)
  }

  if(allocator) {
    return result(allocator[0], allocator[1])
  } else {
    return result()
  }
}

var CACHED_quickSort = {
  "uint32,1,0": function (insertionSort, malloc, free) {
    return function ndarrayQuickSort1d0uint32(left, right, data, offset, s0, s1, n0, n1, d1, e1, f1) {
      var sixth = ((right - left + 1) / 6) | 0,
        index1 = left + sixth,
        index5 = right - sixth,
        index3 = (left + right) >> 1,
        index2 = index3 - sixth,
        index4 = index3 + sixth,
        el1 = index1,
        el2 = index2,
        el3 = index3,
        el4 = index4,
        el5 = index5,
        less = left + 1,
        great = right - 1,
        pivots_are_equal = true,
        tmp,
        tmp0,
        x,
        y,
        z,
        k,
        ptr0,
        ptr1,
        ptr2,
        comp_pivot1 = 0,
        comp_pivot2 = 0,
        comp = 0,
        i1,
        b_ptr0,
        b_ptr1,
        b_ptr2,
        b_ptr3,
        b_ptr4,
        b_ptr5,
        b_ptr6,
        b_ptr7,
        ptr3,
        ptr4,
        ptr5,
        ptr6,
        ptr7,
        pivot_ptr,
        ptr_shift,
        elementSize = n1,
        pivot1 = malloc(elementSize),
        pivot2 = malloc(elementSize)
      b_ptr0 = s0 * el1
      b_ptr1 = s0 * el2
      ptr_shift = offset
      __l1: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el1
          el1 = el2
          el2 = tmp0
          break __l1
        }
        if (comp < 0) {
          break __l1
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el4
      b_ptr1 = s0 * el5
      ptr_shift = offset
      __l2: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el4
          el4 = el5
          el5 = tmp0
          break __l2
        }
        if (comp < 0) {
          break __l2
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el1
      b_ptr1 = s0 * el3
      ptr_shift = offset
      __l3: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el1
          el1 = el3
          el3 = tmp0
          break __l3
        }
        if (comp < 0) {
          break __l3
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el2
      b_ptr1 = s0 * el3
      ptr_shift = offset
      __l4: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el2
          el2 = el3
          el3 = tmp0
          break __l4
        }
        if (comp < 0) {
          break __l4
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el1
      b_ptr1 = s0 * el4
      ptr_shift = offset
      __l5: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el1
          el1 = el4
          el4 = tmp0
          break __l5
        }
        if (comp < 0) {
          break __l5
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el3
      b_ptr1 = s0 * el4
      ptr_shift = offset
      __l6: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el3
          el3 = el4
          el4 = tmp0
          break __l6
        }
        if (comp < 0) {
          break __l6
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el2
      b_ptr1 = s0 * el5
      ptr_shift = offset
      __l7: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el2
          el2 = el5
          el5 = tmp0
          break __l7
        }
        if (comp < 0) {
          break __l7
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el2
      b_ptr1 = s0 * el3
      ptr_shift = offset
      __l8: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el2
          el2 = el3
          el3 = tmp0
          break __l8
        }
        if (comp < 0) {
          break __l8
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el4
      b_ptr1 = s0 * el5
      ptr_shift = offset
      __l9: for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        comp = data[ptr0] - data[ptr1]
        if (comp > 0) {
          tmp0 = el4
          el4 = el5
          el5 = tmp0
          break __l9
        }
        if (comp < 0) {
          break __l9
        }
        ptr_shift += e1
      }
      b_ptr0 = s0 * el1
      b_ptr1 = s0 * el2
      b_ptr2 = s0 * el3
      b_ptr3 = s0 * el4
      b_ptr4 = s0 * el5
      b_ptr5 = s0 * index1
      b_ptr6 = s0 * index3
      b_ptr7 = s0 * index5
      pivot_ptr = 0
      ptr_shift = offset
      for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        ptr2 = b_ptr2 + ptr_shift
        ptr3 = b_ptr3 + ptr_shift
        ptr4 = b_ptr4 + ptr_shift
        ptr5 = b_ptr5 + ptr_shift
        ptr6 = b_ptr6 + ptr_shift
        ptr7 = b_ptr7 + ptr_shift
        pivot1[pivot_ptr] = data[ptr1]
        pivot2[pivot_ptr] = data[ptr3]
        pivots_are_equal = pivots_are_equal && pivot1[pivot_ptr] === pivot2[pivot_ptr]
        x = data[ptr0]
        y = data[ptr2]
        z = data[ptr4]
        data[ptr5] = x
        data[ptr6] = y
        data[ptr7] = z
        ++pivot_ptr
        ptr_shift += d1
      }
      b_ptr0 = s0 * index2
      b_ptr1 = s0 * left
      ptr_shift = offset
      for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        data[ptr0] = data[ptr1]
        ptr_shift += d1
      }
      b_ptr0 = s0 * index4
      b_ptr1 = s0 * right
      ptr_shift = offset
      for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        data[ptr0] = data[ptr1]
        ptr_shift += d1
      }
      if (pivots_are_equal) {
        for (k = less; k <= great; ++k) {
          ptr0 = offset + k * s0
          pivot_ptr = 0
          __l10: for (i1 = 0; i1 < n1; ++i1) {
            comp = data[ptr0] - pivot1[pivot_ptr]
            if (comp !== 0) {
              break __l10
            }
            pivot_ptr += f1
            ptr0 += e1
          }
          if (comp === 0) {
            continue
          }
          if (comp < 0) {
            if (k !== less) {
              b_ptr0 = s0 * k
              b_ptr1 = s0 * less
              ptr_shift = offset
              for (i1 = 0; i1 < n1; ++i1) {
                ptr0 = b_ptr0 + ptr_shift
                ptr1 = b_ptr1 + ptr_shift
                tmp = data[ptr0]
                data[ptr0] = data[ptr1]
                data[ptr1] = tmp
                ptr_shift += d1
              }
            }
            ++less
          } else {
            while (true) {
              ptr0 = offset + great * s0
              pivot_ptr = 0
              __l11: for (i1 = 0; i1 < n1; ++i1) {
                comp = data[ptr0] - pivot1[pivot_ptr]
                if (comp !== 0) {
                  break __l11
                }
                pivot_ptr += f1
                ptr0 += e1
              }
              if (comp > 0) {
                great--
              } else if (comp < 0) {
                b_ptr0 = s0 * k
                b_ptr1 = s0 * less
                b_ptr2 = s0 * great
                ptr_shift = offset
                for (i1 = 0; i1 < n1; ++i1) {
                  ptr0 = b_ptr0 + ptr_shift
                  ptr1 = b_ptr1 + ptr_shift
                  ptr2 = b_ptr2 + ptr_shift
                  tmp = data[ptr0]
                  data[ptr0] = data[ptr1]
                  data[ptr1] = data[ptr2]
                  data[ptr2] = tmp
                  ptr_shift += d1
                }
                ++less
                --great
                break
              } else {
                b_ptr0 = s0 * k
                b_ptr1 = s0 * great
                ptr_shift = offset
                for (i1 = 0; i1 < n1; ++i1) {
                  ptr0 = b_ptr0 + ptr_shift
                  ptr1 = b_ptr1 + ptr_shift
                  tmp = data[ptr0]
                  data[ptr0] = data[ptr1]
                  data[ptr1] = tmp
                  ptr_shift += d1
                }
                --great
                break
              }
            }
          }
        }
      } else {
        for (k = less; k <= great; ++k) {
          ptr0 = offset + k * s0
          pivot_ptr = 0
          __l12: for (i1 = 0; i1 < n1; ++i1) {
            comp_pivot1 = data[ptr0] - pivot1[pivot_ptr]
            if (comp_pivot1 !== 0) {
              break __l12
            }
            pivot_ptr += f1
            ptr0 += e1
          }
          if (comp_pivot1 < 0) {
            if (k !== less) {
              b_ptr0 = s0 * k
              b_ptr1 = s0 * less
              ptr_shift = offset
              for (i1 = 0; i1 < n1; ++i1) {
                ptr0 = b_ptr0 + ptr_shift
                ptr1 = b_ptr1 + ptr_shift
                tmp = data[ptr0]
                data[ptr0] = data[ptr1]
                data[ptr1] = tmp
                ptr_shift += d1
              }
            }
            ++less
          } else {
            ptr0 = offset + k * s0
            pivot_ptr = 0
            __l13: for (i1 = 0; i1 < n1; ++i1) {
              comp_pivot2 = data[ptr0] - pivot2[pivot_ptr]
              if (comp_pivot2 !== 0) {
                break __l13
              }
              pivot_ptr += f1
              ptr0 += e1
            }
            if (comp_pivot2 > 0) {
              while (true) {
                ptr0 = offset + great * s0
                pivot_ptr = 0
                __l14: for (i1 = 0; i1 < n1; ++i1) {
                  comp = data[ptr0] - pivot2[pivot_ptr]
                  if (comp !== 0) {
                    break __l14
                  }
                  pivot_ptr += f1
                  ptr0 += e1
                }
                if (comp > 0) {
                  if (--great < k) {
                    break
                  }
                  continue
                } else {
                  ptr0 = offset + great * s0
                  pivot_ptr = 0
                  __l15: for (i1 = 0; i1 < n1; ++i1) {
                    comp = data[ptr0] - pivot1[pivot_ptr]
                    if (comp !== 0) {
                      break __l15
                    }
                    pivot_ptr += f1
                    ptr0 += e1
                  }
                  if (comp < 0) {
                    b_ptr0 = s0 * k
                    b_ptr1 = s0 * less
                    b_ptr2 = s0 * great
                    ptr_shift = offset
                    for (i1 = 0; i1 < n1; ++i1) {
                      ptr0 = b_ptr0 + ptr_shift
                      ptr1 = b_ptr1 + ptr_shift
                      ptr2 = b_ptr2 + ptr_shift
                      tmp = data[ptr0]
                      data[ptr0] = data[ptr1]
                      data[ptr1] = data[ptr2]
                      data[ptr2] = tmp
                      ptr_shift += d1
                    }
                    ++less
                    --great
                  } else {
                    b_ptr0 = s0 * k
                    b_ptr1 = s0 * great
                    ptr_shift = offset
                    for (i1 = 0; i1 < n1; ++i1) {
                      ptr0 = b_ptr0 + ptr_shift
                      ptr1 = b_ptr1 + ptr_shift
                      tmp = data[ptr0]
                      data[ptr0] = data[ptr1]
                      data[ptr1] = tmp
                      ptr_shift += d1
                    }
                    --great
                  }
                  break
                }
              }
            }
          }
        }
      }
      b_ptr0 = s0 * left
      b_ptr1 = s0 * (less - 1)
      pivot_ptr = 0
      ptr_shift = offset
      for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        data[ptr0] = data[ptr1]
        data[ptr1] = pivot1[pivot_ptr]
        ++pivot_ptr
        ptr_shift += d1
      }
      b_ptr0 = s0 * right
      b_ptr1 = s0 * (great + 1)
      pivot_ptr = 0
      ptr_shift = offset
      for (i1 = 0; i1 < n1; ++i1) {
        ptr0 = b_ptr0 + ptr_shift
        ptr1 = b_ptr1 + ptr_shift
        data[ptr0] = data[ptr1]
        data[ptr1] = pivot2[pivot_ptr]
        ++pivot_ptr
        ptr_shift += d1
      }
      if (less - 2 - left <= 32) {
        insertionSort(left, less - 2, data, offset, s0, s1, n0, n1, d1, e1, f1)
      } else {
        ndarrayQuickSort1d0uint32(left, less - 2, data, offset, s0, s1, n0, n1, d1, e1, f1)
      }
      if (right - (great + 2) <= 32) {
        insertionSort(great + 2, right, data, offset, s0, s1, n0, n1, d1, e1, f1)
      } else {
        ndarrayQuickSort1d0uint32(great + 2, right, data, offset, s0, s1, n0, n1, d1, e1, f1)
      }
      if (pivots_are_equal) {
        free(pivot1)
        free(pivot2)
        return
      }
      if (less < index1 && great > index5) {
        __l16: while (true) {
          ptr0 = offset + less * s0
          pivot_ptr = 0
          ptr_shift = offset
          for (i1 = 0; i1 < n1; ++i1) {
            if (data[ptr0] !== pivot1[pivot_ptr]) {
              break __l16
            }
            ++pivot_ptr
            ptr0 += d1
          }
          ++less
        }
        __l17: while (true) {
          ptr0 = offset + great * s0
          pivot_ptr = 0
          ptr_shift = offset
          for (i1 = 0; i1 < n1; ++i1) {
            if (data[ptr0] !== pivot2[pivot_ptr]) {
              break __l17
            }
            ++pivot_ptr
            ptr0 += d1
          }
          --great
        }
        for (k = less; k <= great; ++k) {
          ptr0 = offset + k * s0
          pivot_ptr = 0
          __l18: for (i1 = 0; i1 < n1; ++i1) {
            comp_pivot1 = data[ptr0] - pivot1[pivot_ptr]
            if (comp_pivot1 !== 0) {
              break __l18
            }
            pivot_ptr += f1
            ptr0 += e1
          }
          if (comp_pivot1 === 0) {
            if (k !== less) {
              b_ptr0 = s0 * k
              b_ptr1 = s0 * less
              ptr_shift = offset
              for (i1 = 0; i1 < n1; ++i1) {
                ptr0 = b_ptr0 + ptr_shift
                ptr1 = b_ptr1 + ptr_shift
                tmp = data[ptr0]
                data[ptr0] = data[ptr1]
                data[ptr1] = tmp
                ptr_shift += d1
              }
            }
            ++less
          } else {
            ptr0 = offset + k * s0
            pivot_ptr = 0
            __l19: for (i1 = 0; i1 < n1; ++i1) {
              comp_pivot2 = data[ptr0] - pivot2[pivot_ptr]
              if (comp_pivot2 !== 0) {
                break __l19
              }
              pivot_ptr += f1
              ptr0 += e1
            }
            if (comp_pivot2 === 0) {
              while (true) {
                ptr0 = offset + great * s0
                pivot_ptr = 0
                __l20: for (i1 = 0; i1 < n1; ++i1) {
                  comp = data[ptr0] - pivot2[pivot_ptr]
                  if (comp !== 0) {
                    break __l20
                  }
                  pivot_ptr += f1
                  ptr0 += e1
                }
                if (comp === 0) {
                  if (--great < k) {
                    break
                  }
                  continue
                } else {
                  ptr0 = offset + great * s0
                  pivot_ptr = 0
                  __l21: for (i1 = 0; i1 < n1; ++i1) {
                    comp = data[ptr0] - pivot1[pivot_ptr]
                    if (comp !== 0) {
                      break __l21
                    }
                    pivot_ptr += f1
                    ptr0 += e1
                  }
                  if (comp < 0) {
                    b_ptr0 = s0 * k
                    b_ptr1 = s0 * less
                    b_ptr2 = s0 * great
                    ptr_shift = offset
                    for (i1 = 0; i1 < n1; ++i1) {
                      ptr0 = b_ptr0 + ptr_shift
                      ptr1 = b_ptr1 + ptr_shift
                      ptr2 = b_ptr2 + ptr_shift
                      tmp = data[ptr0]
                      data[ptr0] = data[ptr1]
                      data[ptr1] = data[ptr2]
                      data[ptr2] = tmp
                      ptr_shift += d1
                    }
                    ++less
                    --great
                  } else {
                    b_ptr0 = s0 * k
                    b_ptr1 = s0 * great
                    ptr_shift = offset
                    for (i1 = 0; i1 < n1; ++i1) {
                      ptr0 = b_ptr0 + ptr_shift
                      ptr1 = b_ptr1 + ptr_shift
                      tmp = data[ptr0]
                      data[ptr0] = data[ptr1]
                      data[ptr1] = tmp
                      ptr_shift += d1
                    }
                    --great
                  }
                  break
                }
              }
            }
          }
        }
      }
      free(pivot1)
      free(pivot2)
      if (great - less <= 32) {
        insertionSort(less, great, data, offset, s0, s1, n0, n1, d1, e1, f1)
      } else {
        ndarrayQuickSort1d0uint32(less, great, data, offset, s0, s1, n0, n1, d1, e1, f1)
      }
    }
  },
}

function createQuickSort(order, dtype, insertionSort) {
  var key = [dtype, order].join(',')

  var code = [ "'use strict'" ]
  var funcName = ["ndarrayQuickSort", order.join("d"), dtype].join("")
  var funcArgs = ["left", "right", "data", "offset" ].concat(shapeArgs(order.length))
  var allocator = getMallocFree(dtype)
  var labelCounter=0

  code.push(["function ", funcName, "(", funcArgs.join(","), "){"].join(""))

  var vars = [
    "sixth=((right-left+1)/6)|0",
    "index1=left+sixth",
    "index5=right-sixth",
    "index3=(left+right)>>1",
    "index2=index3-sixth",
    "index4=index3+sixth",
    "el1=index1",
    "el2=index2",
    "el3=index3",
    "el4=index4",
    "el5=index5",
    "less=left+1",
    "great=right-1",
    "pivots_are_equal=true",
    "tmp",
    "tmp0",
    "x",
    "y",
    "z",
    "k",
    "ptr0",
    "ptr1",
    "ptr2",
    "comp_pivot1=0",
    "comp_pivot2=0",
    "comp=0"
  ]

  if(order.length > 1) {
    var ele_size = []
    for(var i=1; i<order.length; ++i) {
      ele_size.push("n"+i)
      vars.push("i"+i)
    }
    for(var i=0; i<8; ++i) {
      vars.push("b_ptr"+i)
    }
    vars.push(
      "ptr3",
      "ptr4",
      "ptr5",
      "ptr6",
      "ptr7",
      "pivot_ptr",
      "ptr_shift",
      "elementSize="+ele_size.join("*"))
    if(allocator) {
      vars.push("pivot1=malloc(elementSize)",
                "pivot2=malloc(elementSize)")
    } else {
      vars.push("pivot1=new Array(elementSize),pivot2=new Array(elementSize)")
    }
  } else {
    vars.push("pivot1", "pivot2")
  }

  //Initialize local variables
  code.push("var " + vars.join(","))

  function toPointer(v) {
    return ["(offset+",v,"*s0)"].join("")
  }

  function dataRead(ptr) {
    if(dtype === "generic") {
      return ["data.get(", ptr, ")"].join("")
    }
    return ["data[",ptr,"]"].join("")
  }

  function dataWrite(ptr, v) {
    if(dtype === "generic") {
      return ["data.set(", ptr, ",", v, ")"].join("")
    }
    return ["data[",ptr,"]=",v].join("")
  }

  function cacheLoop(ptrs, usePivot, body) {
    if(ptrs.length === 1) {
      code.push("ptr0="+toPointer(ptrs[0]))
    } else {
      for(var i=0; i<ptrs.length; ++i) {
        code.push(["b_ptr",i,"=s0*",ptrs[i]].join(""))
      }
    }
    if(usePivot) {
      code.push("pivot_ptr=0")
    }
    code.push("ptr_shift=offset")
    for(var i=order.length-1; i>=0; --i) {
      var j = order[i]
      if(j === 0) {
        continue
      }
      code.push(["for(i",j,"=0;i",j,"<n",j,";++i",j,"){"].join(""))
    }
    if(ptrs.length > 1) {
      for(var i=0; i<ptrs.length; ++i) {
        code.push(["ptr",i,"=b_ptr",i,"+ptr_shift"].join(""))
      }
    }
    code.push(body)
    if(usePivot) {
      code.push("++pivot_ptr")
    }
    for(var i=0; i<order.length; ++i) {
      var j = order[i]
      if(j === 0) {
        continue
      }
      if(ptrs.length>1) {
        code.push("ptr_shift+=d"+j)
      } else {
        code.push("ptr0+=d"+j)
      }
      code.push("}")
    }
  }

  function lexicoLoop(label, ptrs, usePivot, body) {
    if(ptrs.length === 1) {
      code.push("ptr0="+toPointer(ptrs[0]))
    } else {
      for(var i=0; i<ptrs.length; ++i) {
        code.push(["b_ptr",i,"=s0*",ptrs[i]].join(""))
      }
      code.push("ptr_shift=offset")
    }
    if(usePivot) {
      code.push("pivot_ptr=0")
    }
    if(label) {
      code.push(label+":")
    }
    for(var i=1; i<order.length; ++i) {
      code.push(["for(i",i,"=0;i",i,"<n",i,";++i",i,"){"].join(""))
    }
    if(ptrs.length > 1) {
      for(var i=0; i<ptrs.length; ++i) {
        code.push(["ptr",i,"=b_ptr",i,"+ptr_shift"].join(""))
      }
    }
    code.push(body)
    for(var i=order.length-1; i>=1; --i) {
      if(usePivot) {
        code.push("pivot_ptr+=f"+i)
      }
      if(ptrs.length > 1) {
        code.push("ptr_shift+=e"+i)
      } else {
        code.push("ptr0+=e"+i)
      }
      code.push("}")
    }
  }

  function cleanUp() {
    if(order.length > 1 && allocator) {
      code.push("free(pivot1)", "free(pivot2)")
    }
  }

  function compareSwap(a_id, b_id) {
    var a = "el"+a_id
    var b = "el"+b_id
    if(order.length > 1) {
      var lbl = "__l" + (++labelCounter)
      lexicoLoop(lbl, [a, b], false, [
        "comp=",dataRead("ptr0"),"-",dataRead("ptr1"),"\n",
        "if(comp>0){tmp0=", a, ";",a,"=",b,";", b,"=tmp0;break ", lbl,"}\n",
        "if(comp<0){break ", lbl, "}"
      ].join(""))
    } else {
      code.push(["if(", dataRead(toPointer(a)), ">", dataRead(toPointer(b)), "){tmp0=", a, ";",a,"=",b,";", b,"=tmp0}"].join(""))
    }
  }

  compareSwap(1, 2)
  compareSwap(4, 5)
  compareSwap(1, 3)
  compareSwap(2, 3)
  compareSwap(1, 4)
  compareSwap(3, 4)
  compareSwap(2, 5)
  compareSwap(2, 3)
  compareSwap(4, 5)

  if(order.length > 1) {
    cacheLoop(["el1", "el2", "el3", "el4", "el5", "index1", "index3", "index5"], true, [
      "pivot1[pivot_ptr]=",dataRead("ptr1"),"\n",
      "pivot2[pivot_ptr]=",dataRead("ptr3"),"\n",
      "pivots_are_equal=pivots_are_equal&&(pivot1[pivot_ptr]===pivot2[pivot_ptr])\n",
      "x=",dataRead("ptr0"),"\n",
      "y=",dataRead("ptr2"),"\n",
      "z=",dataRead("ptr4"),"\n",
      dataWrite("ptr5", "x"),"\n",
      dataWrite("ptr6", "y"),"\n",
      dataWrite("ptr7", "z")
    ].join(""))
  } else {
    code.push([
      "pivot1=", dataRead(toPointer("el2")), "\n",
      "pivot2=", dataRead(toPointer("el4")), "\n",
      "pivots_are_equal=pivot1===pivot2\n",
      "x=", dataRead(toPointer("el1")), "\n",
      "y=", dataRead(toPointer("el3")), "\n",
      "z=", dataRead(toPointer("el5")), "\n",
      dataWrite(toPointer("index1"), "x"), "\n",
      dataWrite(toPointer("index3"), "y"), "\n",
      dataWrite(toPointer("index5"), "z")
    ].join(""))
  }


  function moveElement(dst, src) {
    if(order.length > 1) {
      cacheLoop([dst, src], false,
        dataWrite("ptr0", dataRead("ptr1"))
      )
    } else {
      code.push(dataWrite(toPointer(dst), dataRead(toPointer(src))))
    }
  }

  moveElement("index2", "left")
  moveElement("index4", "right")

  function comparePivot(result, ptr, n) {
    if(order.length > 1) {
      var lbl = "__l" + (++labelCounter)
      lexicoLoop(lbl, [ptr], true, [
        result,"=",dataRead("ptr0"),"-pivot",n,"[pivot_ptr]\n",
        "if(",result,"!==0){break ", lbl, "}"
      ].join(""))
    } else {
      code.push([result,"=", dataRead(toPointer(ptr)), "-pivot", n].join(""))
    }
  }

  function swapElements(a, b) {
    if(order.length > 1) {
      cacheLoop([a,b],false,[
        "tmp=",dataRead("ptr0"),"\n",
        dataWrite("ptr0", dataRead("ptr1")),"\n",
        dataWrite("ptr1", "tmp")
      ].join(""))
    } else {
      code.push([
        "ptr0=",toPointer(a),"\n",
        "ptr1=",toPointer(b),"\n",
        "tmp=",dataRead("ptr0"),"\n",
        dataWrite("ptr0", dataRead("ptr1")),"\n",
        dataWrite("ptr1", "tmp")
      ].join(""))
    }
  }

  function tripleSwap(k, less, great) {
    if(order.length > 1) {
      cacheLoop([k,less,great], false, [
        "tmp=",dataRead("ptr0"),"\n",
        dataWrite("ptr0", dataRead("ptr1")),"\n",
        dataWrite("ptr1", dataRead("ptr2")),"\n",
        dataWrite("ptr2", "tmp")
      ].join(""))
      code.push("++"+less, "--"+great)
    } else {
      code.push([
        "ptr0=",toPointer(k),"\n",
        "ptr1=",toPointer(less),"\n",
        "ptr2=",toPointer(great),"\n",
        "++",less,"\n",
        "--",great,"\n",
        "tmp=", dataRead("ptr0"), "\n",
        dataWrite("ptr0", dataRead("ptr1")), "\n",
        dataWrite("ptr1", dataRead("ptr2")), "\n",
        dataWrite("ptr2", "tmp")
      ].join(""))
    }
  }

  function swapAndDecrement(k, great) {
    swapElements(k, great)
    code.push("--"+great)
  }

  code.push("if(pivots_are_equal){")
    //Pivots are equal case
    code.push("for(k=less;k<=great;++k){")
      comparePivot("comp", "k", 1)
      code.push("if(comp===0){continue}")
      code.push("if(comp<0){")
        code.push("if(k!==less){")
          swapElements("k", "less")
        code.push("}")
        code.push("++less")
      code.push("}else{")
        code.push("while(true){")
          comparePivot("comp", "great", 1)
          code.push("if(comp>0){")
            code.push("great--")
          code.push("}else if(comp<0){")
            tripleSwap("k", "less", "great")
            code.push("break")
          code.push("}else{")
            swapAndDecrement("k", "great")
            code.push("break")
          code.push("}")
        code.push("}")
      code.push("}")
    code.push("}")
  code.push("}else{")
    //Pivots not equal case
    code.push("for(k=less;k<=great;++k){")
      comparePivot("comp_pivot1", "k", 1)
      code.push("if(comp_pivot1<0){")
        code.push("if(k!==less){")
          swapElements("k", "less")
        code.push("}")
        code.push("++less")
      code.push("}else{")
        comparePivot("comp_pivot2", "k", 2)
        code.push("if(comp_pivot2>0){")
          code.push("while(true){")
            comparePivot("comp", "great", 2)
            code.push("if(comp>0){")
              code.push("if(--great<k){break}")
              code.push("continue")
            code.push("}else{")
              comparePivot("comp", "great", 1)
              code.push("if(comp<0){")
                tripleSwap("k", "less", "great")
              code.push("}else{")
                swapAndDecrement("k", "great")
              code.push("}")
              code.push("break")
            code.push("}")
          code.push("}")
        code.push("}")
      code.push("}")
    code.push("}")
  code.push("}")

  //Move pivots to correct place
  function storePivot(mem_dest, pivot_dest, pivot) {
    if(order.length>1) {
      cacheLoop([mem_dest, pivot_dest], true, [
        dataWrite("ptr0", dataRead("ptr1")), "\n",
        dataWrite("ptr1", ["pivot",pivot,"[pivot_ptr]"].join(""))
      ].join(""))
    } else {
      code.push(
          dataWrite(toPointer(mem_dest), dataRead(toPointer(pivot_dest))),
          dataWrite(toPointer(pivot_dest), "pivot"+pivot))
    }
  }

  storePivot("left", "(less-1)", 1)
  storePivot("right", "(great+1)", 2)

  //Recursive sort call
  function doSort(left, right) {
    code.push([
      "if((",right,"-",left,")<=",INSERTION_SORT_THRESHOLD,"){\n",
        "insertionSort(", left, ",", right, ",data,offset,", shapeArgs(order.length).join(","), ")\n",
      "}else{\n",
        funcName, "(", left, ",", right, ",data,offset,", shapeArgs(order.length).join(","), ")\n",
      "}"
    ].join(""))
  }
  doSort("left", "(less-2)")
  doSort("(great+2)", "right")

  //If pivots are equal, then early out
  code.push("if(pivots_are_equal){")
    cleanUp()
    code.push("return")
  code.push("}")

  function walkPointer(ptr, pivot, body) {
    if(order.length > 1) {
      code.push(["__l",++labelCounter,":while(true){"].join(""))
      cacheLoop([ptr], true, [
        "if(", dataRead("ptr0"), "!==pivot", pivot, "[pivot_ptr]){break __l", labelCounter, "}"
      ].join(""))
      code.push(body, "}")
    } else {
      code.push(["while(", dataRead(toPointer(ptr)), "===pivot", pivot, "){", body, "}"].join(""))
    }
  }

  //Check bounds
  code.push("if(less<index1&&great>index5){")

    walkPointer("less", 1, "++less")
    walkPointer("great", 2, "--great")

    code.push("for(k=less;k<=great;++k){")
      comparePivot("comp_pivot1", "k", 1)
      code.push("if(comp_pivot1===0){")
        code.push("if(k!==less){")
          swapElements("k", "less")
        code.push("}")
        code.push("++less")
      code.push("}else{")
        comparePivot("comp_pivot2", "k", 2)
        code.push("if(comp_pivot2===0){")
          code.push("while(true){")
            comparePivot("comp", "great", 2)
            code.push("if(comp===0){")
              code.push("if(--great<k){break}")
              code.push("continue")
            code.push("}else{")
              comparePivot("comp", "great", 1)
              code.push("if(comp<0){")
                tripleSwap("k", "less", "great")
              code.push("}else{")
                swapAndDecrement("k", "great")
              code.push("}")
              code.push("break")
            code.push("}")
          code.push("}")
        code.push("}")
      code.push("}")
    code.push("}")
  code.push("}")

  //Clean up and do a final sorting pass
  cleanUp()
  doSort("less", "great")

  //Close off main loop
  code.push("}return " + funcName)

  var result = CACHED_quickSort[key]
  if (!result) {
    //Compile and link
    if(order.length > 1 && allocator) {
      result = new Function("insertionSort", "malloc", "free", code.join("\n"))
    } else {
      result = new Function("insertionSort", code.join("\n"))
    }
    console.log(key, result)
  }

  if(order.length > 1 && allocator) {
    return result(insertionSort, allocator[0], allocator[1])
  } else {
    return result(insertionSort)
  }
}

var CACHED_sort = {
  "uint32,1,0": function (insertionSort, quickSort) {
    return function (array) {
      var data = array.data,
        offset = array.offset | 0,
        shape = array.shape,
        stride = array.stride,
        s0 = stride[0] | 0,
        n0 = shape[0] | 0,
        s1 = stride[1] | 0,
        n1 = shape[1] | 0,
        d1 = s1,
        e1 = s1,
        f1 = 1
      if (n0 <= 32) {
        insertionSort(0, n0 - 1, data, offset, s0, s1, n0, n1, d1, e1, f1)
      } else {
        quickSort(0, n0 - 1, data, offset, s0, s1, n0, n1, d1, e1, f1)
      }
    }
  },
}

function compileSort(order, dtype) {
  var key = [dtype, order].join(',')

  var code = ["'use strict'"]
  var funcName = ["ndarraySortWrapper", order.join("d"), dtype].join("")
  var funcArgs = [ "array" ]

  code.push(["function ", funcName, "(", funcArgs.join(","), "){"].join(""))

  //Unpack local variables from array
  var vars = ["data=array.data,offset=array.offset|0,shape=array.shape,stride=array.stride"]
  for(var i=0; i<order.length; ++i) {
    vars.push(["s",i,"=stride[",i,"]|0,n",i,"=shape[",i,"]|0"].join(""))
  }

  var scratch_stride = new Array(order.length)
  var nprod = []
  for(var i=0; i<order.length; ++i) {
    var k = order[i]
    if(k === 0) {
      continue
    }
    if(nprod.length === 0) {
      scratch_stride[k] = "1"
    } else {
      scratch_stride[k] = nprod.join("*")
    }
    nprod.push("n"+k)
  }

  var p = -1, q = -1
  for(var i=0; i<order.length; ++i) {
    var j = order[i]
    if(j !== 0) {
      if(p > 0) {
        vars.push(["d",j,"=s",j,"-d",p,"*n",p].join(""))
      } else {
        vars.push(["d",j,"=s",j].join(""))
      }
      p = j
    }
    var k = order.length-1-i
    if(k !== 0) {
      if(q > 0) {
        vars.push(["e",k,"=s",k,"-e",q,"*n",q,
                  ",f",k,"=",scratch_stride[k],"-f",q,"*n",q].join(""))
      } else {
        vars.push(["e",k,"=s",k,",f",k,"=",scratch_stride[k]].join(""))
      }
      q = k
    }
  }

  //Declare local variables
  code.push("var " + vars.join(","))

  //Create arguments for subroutine
  var sortArgs = ["0", "n0-1", "data", "offset"].concat(shapeArgs(order.length))

  //Call main sorting routine
  code.push([
    "if(n0<=",INSERTION_SORT_THRESHOLD,"){",
      "insertionSort(", sortArgs.join(","), ")}else{",
      "quickSort(", sortArgs.join(","),
    ")}"
  ].join(""))

  //Return
  code.push("}return " + funcName)

  //Link everything together
  var result = CACHED_sort[key]
  if (!result) {
    result = new Function("insertionSort", "quickSort", code.join("\n"))
    console.log(key, result)
  }

  var insertionSort = createInsertionSort(order, dtype)
  var quickSort = createQuickSort(order, dtype, insertionSort)
  return result(insertionSort, quickSort)
}

module.exports = compileSort