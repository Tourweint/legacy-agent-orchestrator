package org.campus.classroom.service;

import org.campus.classroom.dto.ClassroomCreateDTO;
import org.campus.classroom.dto.ClassroomUpdateDTO;
import org.campus.classroom.vo.BuildingPreferenceVO;
import org.campus.classroom.vo.ClassroomVO;

import java.util.List;

public interface ClassroomService {

    Long create(ClassroomCreateDTO request);

    Boolean update(Long id, ClassroomUpdateDTO request);

    ClassroomVO getClassroomById(Long id);

    List<String> listBuildings();

    List<ClassroomVO> getAvailableClassroomList(String building, Integer minCapacity);

    List<BuildingPreferenceVO> listPreferredBuildings(Long currentUserId);

    List<ClassroomVO> adminGetClassroomList(String building, Integer minCapacity, String status);
}
